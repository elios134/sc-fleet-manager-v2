/* Types des Actualités (miroir de get_rsi_server_status et get_rsi_news). */

export type RsiComponent = { name: string; status: string };
export type RsiServerStatus = { overall: string; overallLabel: string; components: RsiComponent[] };
export type NewsItem = {
  title: string;
  link: string;
  pubDate: string | null;
  category: string | null;
  summary: string | null;
  image: string | null;
};
