"use client";

import { useState } from "react";
import { Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useStickers, type CatalogSticker } from "@/hooks/useStickers";

// 입력창 옆 스티커 선택 팝오버. 선택 시 onSelect로 스티커를 올려보내고 닫는다.
export function StickerPicker({ onSelect }: { onSelect: (sticker: CatalogSticker) => void }) {
  const { stickers } = useStickers();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="icon" aria-label="스티커 선택">
          <Smile className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        {stickers.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">등록된 스티커가 없어요</p>
        ) : (
          <div className="grid grid-cols-4 gap-1">
            {stickers.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  onSelect(s);
                  setOpen(false);
                }}
                aria-label={s.label}
                className="aspect-square rounded-md p-1 transition-colors hover:bg-muted"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.imageUrl} alt={s.label} className="size-full object-contain" />
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
