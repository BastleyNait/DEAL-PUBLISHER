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
  /** Ciudades donde ya quedó publicada (si un intento anterior falló a mitad). */
  postedLocations: string[];
}

/** Puerto: de dónde salen los jobs pendientes y cómo se marca el resultado. */
export interface JobQueue {
  /** El más viejo en cola, o null si no hay nada para postear ahora. */
  claimNext(): Promise<PublishJob | null>;
  /**
   * El job con el contenido vigente de revolt-laptops.com (lo editado en
   * /admin después de publicar). Si falla, el job se marca 'failed' con el
   * motivo: mejor eso que postear en Facebook un texto que ya corregiste.
   */
  refresh(job: PublishJob): Promise<PublishJob>;
  /** Anota una ciudad más como publicada, apenas se publica en ella. */
  markLocationPosted(itemId: string, location: string): Promise<void>;
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
  /** El interruptor "Auto-publicar" del dashboard. Si no se puede leer, false (pedir confirmación). */
  isAutoPublish(): Promise<boolean>;
  stop(): Promise<void>;
}

/** Puerto: postear un job en Facebook Marketplace. Un driver por implementación (hoy Playwright). */
export interface MarketplaceDriver {
  /** Publica el job con esa ubicación en el formulario. */
  post(job: PublishJob, location: string): Promise<void>;
  close(): Promise<void>;
}
