import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobQueue, PublishJob } from "../domain/types.js";

interface PublicationRow {
  item_id: string;
  ebay_url: string;
  title: string;
  description: string;
  price_usd: string | number;
  price_pen: string | number | null;
  currency: string;
  image_urls: string[];
}

/**
 * Lee/escribe la tabla `publications` del proyecto de Supabase de DEAL
 * HUNTER — este worker no tiene base propia, comparte esa. Un solo worker
 * local corriendo a la vez, así que no hace falta un claim atómico
 * (select-for-update): se procesa un job entero (postear, marcar) antes de
 * pedir el siguiente. Si el proceso se cae a mitad de un job, ese job queda
 * en 'queued' y se reintenta solo en el próximo arranque — mejor eso que
 * quedar en un estado intermedio que nadie reintenta.
 */
export class SupabaseJobQueue implements JobQueue {
  constructor(private readonly supabase: SupabaseClient) {}

  async claimNext(): Promise<PublishJob | null> {
    const { data, error } = await this.supabase
      .from("publications")
      .select("item_id, ebay_url, title, description, price_usd, price_pen, currency, image_urls")
      .eq("facebook_status", "queued")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`No se pudo leer la cola: ${error.message}`);
    if (!data) return null;

    const row = data as PublicationRow;
    return {
      itemId: row.item_id,
      ebayUrl: row.ebay_url,
      title: row.title,
      description: row.description,
      priceUsd: Number(row.price_usd),
      // Fallback por si alguna fila quedó sin migrar: mejor un tipo de cambio
      // aproximado que mandar dólares al campo de precio de Facebook.
      pricePen: row.price_pen != null ? Number(row.price_pen) : Math.round(Number(row.price_usd) * 3.7),
      currency: row.currency,
      imageUrls: row.image_urls ?? [],
    };
  }

  async markPosted(itemId: string): Promise<void> {
    const { error } = await this.supabase
      .from("publications")
      .update({ facebook_status: "posted", facebook_posted_at: new Date().toISOString(), facebook_error: null })
      .eq("item_id", itemId);
    if (error) throw new Error(`No se pudo marcar ${itemId} como posteado: ${error.message}`);
  }

  async markFailed(itemId: string, errorMessage: string): Promise<void> {
    const { error } = await this.supabase
      .from("publications")
      .update({ facebook_status: "failed", facebook_error: errorMessage.slice(0, 2000) })
      .eq("item_id", itemId);
    if (error) throw new Error(`No se pudo marcar ${itemId} como fallido: ${error.message}`);
  }
}
