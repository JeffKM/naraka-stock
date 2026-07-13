import { redirect } from "next/navigation";

// 거래내역은 지갑 페이지로 통합 — 기존 링크 호환을 위한 리다이렉트
export default function HistoryPage() {
  redirect("/portfolio");
}
