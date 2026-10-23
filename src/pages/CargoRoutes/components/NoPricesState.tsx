import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight } from "lucide-react";
import { EmptyState } from "../../../components/ui/EmptyState";

/** Aucun prix UEX en base : les routes ne peuvent pas être calculées → action de synchro. */
export function NoPricesState() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <EmptyState
      icon={ArrowLeftRight}
      title={t("empty.cargo.title")}
      text={t("empty.cargo.text")}
      action={{ label: t("cargo.empty.noPricesCta"), onClick: () => navigate("/settings#donnees") }}
    />
  );
}
