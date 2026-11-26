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
  facebook_posted_locations: string[] | null;
}

/** Lo que devuelve la acción facebook-sync: lo vigente en revolt-laptops.com (null = sin cambios). */
interface FreshContent {
  title: string;
  description: string | null;
  imageUrls: string[] | null;
  pricePen: number | null;
}

async function readErrorBody(error: { message: string; context?: unknown }): Promise<string> {
  const response = error.context;
  if (response instanceof Response) {
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) return body.error;
    } catch {
      // cuerpo no JSON: queda el mensaje genérico
    }
  }
  return error.message;
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
      .select("item_id, ebay_url, title, description, price_usd, price_pen, currency, image_urls, facebook_posted_locations")
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
      postedLocations: row.facebook_posted_locations ?? [],
    };
  }

  async refresh(job: PublishJob): Promise<PublishJob> {
    const { data, error } = await this.supabase.functions.invoke<{ data: FreshContent | null }>("publish-deal", {
      body: { action: "facebook-sync", itemId: job.itemId },
    });
    if (error) {
      // El cuerpo de la respuesta trae el motivo real ("ya no existe en la tienda", etc.).
      const detail = await readErrorBody(error);
      throw new Error(`No se pudo leer el producto actual de la tienda: ${detail}`);
    }
    const fresh = data?.data;
    if (!fresh) return job; // publicación vieja sin producto en la tienda
    return {
      ...job,
      title: fresh.title,
      description: fresh.description ?? job.description,
      imageUrls: fresh.imageUrls ?? job.imageUrls,
      pricePen: fresh.pricePen ?? job.pricePen,
    };
  }

  async markLocationPosted(itemId: string, location: string): Promise<void> {
    // Leer y escribir alcanza: hay un solo publicador a la vez (ver
    // StatusReporter.claim), así que nadie más toca esta fila mientras tanto.
    const { data, error: readError } = await this.supabase
      .from("publications")
      .select("facebook_posted_locations")
      .eq("item_id", itemId)
      .single();
    if (readError) throw new Error(`No se pudo leer las ciudades de ${itemId}: ${readError.message}`);
    const done: string[] = data?.facebook_posted_locations ?? [];
    if (done.includes(location)) return;
    const { error } = await this.supabase
      .from("publications")
      .update({ facebook_posted_locations: [...done, location] })
      .eq("item_id", itemId);
    if (error) throw new Error(`No se pudo anotar ${location} para ${itemId}: ${error.message}`);
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
