import type { JobQueue, MarketplaceDriver, StatusReporter } from "../domain/types.js";

/**
 * Bucle: pedir el siguiente job en cola, postearlo, marcar el resultado,
 * repetir. Un job que falla no frena el worker — se marca 'failed' con el
 * motivo (columna facebook_error) y se sigue con el siguiente, así un
 * selector roto en una publicación no traba las demás.
 */
export class PublishWorker {
  constructor(
    private readonly queue: JobQueue,
    private readonly driver: MarketplaceDriver,
    private readonly pollIntervalMs: number,
    private readonly reporter?: StatusReporter,
  ) {}

  async runForever(): Promise<never> {
    console.log(`Worker arrancado. Revisando la cola cada ${this.pollIntervalMs / 1000}s. Ctrl+C para salir.`);
    for (;;) {
      await this.drainQueue();
      await sleep(this.pollIntervalMs);
    }
  }

  /** Procesa todo lo que haya en cola ahora mismo, sin esperar. Útil para pruebas. */
  async drainQueue(): Promise<number> {
    let processed = 0;
    for (;;) {
      let job;
      try {
        job = await this.queue.claimNext();
      } catch (err) {
        // Un corte de red o un hiccup de Supabase no puede tirar abajo el
        // proceso entero: se loguea y se reintenta en la próxima vuelta, en
        // vez de que el worker quede muerto hasta que alguien lo reinicie.
        console.error("No se pudo consultar la cola, reintento en la próxima vuelta:", err);
        return processed;
      }
      if (!job) return processed;

      console.log(`Publicando ${job.itemId} — ${job.title}`);
      this.reporter?.set("working", { itemId: job.itemId, title: job.title });
      try {
        await this.driver.post(job);
        await this.queue.markPosted(job.itemId);
        console.log(`✅ ${job.itemId} publicado.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`❌ ${job.itemId} falló: ${message}`);
        await this.queue.markFailed(job.itemId, message);
      } finally {
        this.reporter?.set("idle");
      }
      processed++;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
