/** Un renglón de la tabla `publications` (proyecto DEAL HUNTER) listo para postear. */
export interface PublishJob {
  itemId: string;
  ebayUrl: string;
  title: string;
  description: string;
  priceUsd: number;
  /** Precio en soles: es el que va en el campo Price de Facebook, no priceUsd (la cuenta está en Perú). */
  pricePen: number;
  currency: string;
  imageUrls: string[];
}

/** Puerto: de dónde salen los jobs pendientes y cómo se marca el resultado. */
export interface JobQueue {
  /** El más viejo en cola, o null si no hay nada para postear ahora. */
  claimNext(): Promise<PublishJob | null>;
  markPosted(itemId: string): Promise<void>;
  markFailed(itemId: string, error: string): Promise<void>;
}

export type PublisherState = "idle" | "working" | "waiting_confirm";

/**
 * Puerto: avisarle al dashboard que el publicador está vivo y qué hace. Una
 * página web no puede abrir un programa de tu PC ni saber si está
 * encendido, así que el publicador lo cuenta él mismo.
 */
export interface StatusReporter {
  /**
   * Toma el lugar de único publicador. Devuelve false si ya hay otro con un
   * latido fresco: dos instancias no pueden compartir el perfil de Chromium
   * con la sesión de Facebook, y publicarían la misma cola dos veces.
   */
  claim(): Promise<boolean>;
  set(state: PublisherState, job?: { itemId: string; title: string }): void;
  stop(): Promise<void>;
}

/** Puerto: postear un job en Facebook Marketplace. Un driver por implementación (hoy Playwright). */
export interface MarketplaceDriver {
  post(job: PublishJob): Promise<void>;
  close(): Promise<void>;
}
