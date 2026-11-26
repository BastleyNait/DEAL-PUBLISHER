import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublisherState, StatusReporter } from "../domain/types.js";

const HEARTBEAT_MS = 10_000;
// Un latido más viejo que esto cuenta como "apagado": tres latidos perdidos.
const STALE_MS = 30_000;

/**
 * Escribe en publisher_status (una sola fila) cada pocos segundos. El
 * dashboard lee esa fila para mostrar "en línea / apagado" y qué está
 * haciendo. Un latido que falla (corte de red) se loguea y se reintenta en el
 * siguiente: no puede tumbar al publicador por algo que es solo informativo.
 */
export class SupabaseStatusReporter implements StatusReporter {
  private state: PublisherState = "idle";
  private job: { itemId: string; title: string } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly startedAt = new Date().toISOString();

  constructor(private readonly supabase: SupabaseClient) {}

  async claim(): Promise<boolean> {
    const { data, error } = await this.supabase.from("publisher_status").select("last_seen").eq("id", 1).maybeSingle();
    if (error) {
      // Sin poder leer el estado no se puede saber si hay otro: se sigue, es
      // mejor que dejar al publicador sin arrancar por un hipo de red.
      console.warn("No se pudo revisar si ya hay un publicador corriendo:", error.message);
    } else if (data && Date.now() - new Date(data.last_seen as string).getTime() < STALE_MS) {
      return false;
    }

    await this.beat();
    this.timer = setInterval(() => void this.beat(), HEARTBEAT_MS);
    return true;
  }

  set(state: PublisherState, job?: { itemId: string; title: string }): void {
    this.state = state;
    this.job = job ?? (state === "idle" ? null : this.job);
    // Se refleja al toque en vez de esperar al próximo latido: "esperando tu
    // confirmación" es justo el estado que no puede llegar 10 s tarde.
    void this.beat();
  }

  async isAutoPublish(): Promise<boolean> {
    const { data, error } = await this.supabase.from("publisher_status").select("auto_publish").eq("id", 1).maybeSingle();
    // Ante la duda, preguntar: publicar sin querer es peor que un click de más.
    if (error) return false;
    return data?.auto_publish === true;
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Se marca como visto hace rato, no se borra: así el dashboard muestra
    // "apagado" de inmediato en vez de esperar a que venza el latido.
    await this.supabase
      .from("publisher_status")
      .update({ last_seen: new Date(0).toISOString(), state: "idle", current_item: null, current_title: null })
      .eq("id", 1)
      .then(() => undefined, () => undefined);
  }

  private async beat(): Promise<void> {
    const { error } = await this.supabase.from("publisher_status").upsert({
      id: 1,
      last_seen: new Date().toISOString(),
      state: this.state,
      current_item: this.job?.itemId ?? null,
      current_title: this.job?.title ?? null,
      started_at: this.startedAt,
    });
    if (error) console.warn("No se pudo enviar el latido al dashboard:", error.message);
  }
}
