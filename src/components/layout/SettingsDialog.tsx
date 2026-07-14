"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  BellIcon,
  BookOpenIcon,
  ChevronRightIcon,
  SettingsIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { playPreviewSound } from "@/lib/sound";
import { useSettingsStore } from "@/lib/settingsStore";
import { cn } from "@/lib/utils";

// 색상 모드 미리보기 카드 (토스 설정 벤치마킹) — 미니 앱 화면 모양의 선택 버튼
function ThemePreviewCard({
  mode,
  label,
  selected,
  onSelect,
}: {
  mode: "dark" | "light";
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const dark = mode === "dark";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="flex flex-col items-center gap-2 outline-none"
    >
      <span
        className={cn(
          "flex h-16 w-24 flex-col justify-between rounded-xl border-2 p-2 transition-all",
          dark
            ? "border-white/10 bg-[oklch(0.2_0.015_25)]"
            : "border-black/10 bg-[oklch(0.97_0.01_85)]",
          selected && "border-primary ring-2 ring-primary/30"
        )}
      >
        <span
          className={cn(
            "h-1.5 w-8 rounded-full",
            dark ? "bg-white/25" : "bg-black/15"
          )}
        />
        <span className="flex items-end justify-between">
          <span
            className={cn(
              "h-5 w-9 rounded-md",
              dark ? "bg-white/15" : "bg-black/8"
            )}
          />
          <span className="h-2.5 w-6 rounded-full bg-[#e0434f]" />
        </span>
      </span>
      <span
        className={cn(
          "text-sm",
          selected ? "font-semibold text-foreground" : "text-muted-foreground"
        )}
      >
        {label}
      </span>
    </button>
  );
}

// 헤더 설정 버튼 + 설정 모달 (색상 모드 / 효과음 볼륨 / 변동 알림)
export function SettingsDialog() {
  const { resolvedTheme, setTheme } = useTheme();
  const volume = useSettingsStore((s) => s.volume);
  const setVolume = useSettingsStore((s) => s.setVolume);
  const alertsEnabled = useSettingsStore((s) => s.alertsEnabled);
  const setAlertsEnabled = useSettingsStore((s) => s.setAlertsEnabled);

  // next-themes는 SSR 시점에 테마를 알 수 없으므로 하이드레이션 후에만 선택 상태를 그린다
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const theme = hydrated ? resolvedTheme : undefined;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="설정" className="text-muted-foreground">
          <SettingsIcon className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>설정</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {/* 색상 모드 */}
          <section>
            <h3 className="mb-3 text-sm font-semibold">색상 모드</h3>
            <div className="flex gap-6">
              <ThemePreviewCard
                mode="dark"
                label="다크"
                selected={theme === "dark"}
                onSelect={() => setTheme("dark")}
              />
              <ThemePreviewCard
                mode="light"
                label="라이트"
                selected={theme === "light"}
                onSelect={() => setTheme("light")}
              />
            </div>
          </section>

          <Separator />

          {/* 효과음 볼륨 */}
          <section>
            <h3 className="mb-3 text-sm font-semibold">효과음 볼륨</h3>
            <div className="flex items-center gap-3">
              {volume === 0 ? (
                <VolumeXIcon className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <Volume2Icon className="size-4 shrink-0 text-muted-foreground" />
              )}
              <Slider
                value={[volume]}
                onValueChange={([v]) => setVolume(v)}
                onValueCommit={() => playPreviewSound()}
                min={0}
                max={100}
                step={5}
                aria-label="효과음 볼륨"
              />
              <span className="w-8 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                {volume}
              </span>
            </div>
          </section>

          <Separator />

          {/* 변동 알림 */}
          <section className="flex items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <BellIcon className="size-4" />
                보유 종목 변동 알림
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                보유 종목이 전일 대비 10% 단위로 오르내리면 알려드려요
              </p>
            </div>
            <Switch
              checked={alertsEnabled}
              onCheckedChange={setAlertsEnabled}
              aria-label="보유 종목 변동 알림"
            />
          </section>

          <Separator />

          {/* 게임 방법 (가이드 페이지로 이동) — 링크 클릭 시 모달을 닫으며 이동 */}
          <DialogClose asChild>
            <Button
              asChild
              variant="ghost"
              className="-mx-2 h-auto justify-between px-2 py-2"
            >
              <Link href="/guide">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <BookOpenIcon className="size-4" />
                  게임 방법
                </span>
                <ChevronRightIcon className="size-4 text-muted-foreground" />
              </Link>
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
