import { useState } from "react";
import { useTranslation } from "react-i18next";
import { checkSourceUrl } from "../state";

/* Ajout d'une source perso (URL d'un global.ini) : contrôle immédiat, le Rust vérifie le contenu. */
export function AddSourceForm({ onAdd }: { onAdd: (name: string, url: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const check = checkSourceUrl(url);
    if (check !== "ok") return setErr(t(check === "notHttps" ? "translation.srcNotHttps" : "translation.srcNotIni"));
    setBusy(true);
    setErr(null);
    try {
      await onAdd(name, url);
      setName("");
      setUrl("");
    } catch (e2) {
      setErr(String(e2));
    } finally {
      setBusy(false);
    }
  };

  const input =
    "w-full rounded-[10px] border border-white/15 bg-white/[0.03] px-3 py-2 text-[13px] text-white outline-none placeholder:text-white/40 focus:border-[var(--accent)]";
  const label = "pl-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-white/40";

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2.5 rounded-2xl border border-white/10 bg-black/40 px-4 py-3.5 backdrop-blur">
      <label className="flex flex-col gap-1.5">
        <span className={label}>{t("translation.srcName")}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("translation.srcNamePh")} className={input} />
      </label>
      <label className="flex min-w-[260px] flex-1 flex-col gap-1.5">
        <span className={label}>{t("translation.srcUrl")}</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/global.ini" className={input} />
      </label>
      <button type="submit" disabled={busy || !url.trim()} className="rounded-[10px] bg-[var(--accent)] px-3.5 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50">
        {busy ? t("translation.working") : t("translation.srcAdd")}
      </button>
      {err ? (
        <p className="w-full pl-0.5 text-[11.5px] text-red-400">{err}</p>
      ) : (
        <p className="w-full pl-0.5 text-[11px] text-white/40">{t("translation.srcHint")}</p>
      )}
    </form>
  );
}
