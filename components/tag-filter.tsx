"use client";

import {X} from "lucide-react";

import {cn} from "@/lib/utils";
import {getTagColorClass} from "@/lib/utils/tag-colors";

const CONTROL_BUTTON_CLASS =
  "transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-95";

interface TagFilterProps {
  tags: string[];
  selectedTags: string[];
  onToggle: (tag: string) => void;
  onClear: () => void;
  className?: string;
}

export function TagFilter({
  tags,
  selectedTags,
  onToggle,
  onClear,
  className,
}: TagFilterProps) {
  if (tags.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {tags.map((tag) => {
        const isSelected = selectedTags.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onToggle(tag)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-95",
              isSelected
                ? cn(getTagColorClass(tag), "ring-2 ring-foreground/20")
                : "bg-muted/50 text-muted-foreground hover:bg-muted"
            )}
          >
            {tag}
          </button>
        );
      })}
      {selectedTags.length > 0 && (
        <button
          type="button"
          onClick={onClear}
          className={cn(
            "flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground hover:text-foreground",
            CONTROL_BUTTON_CLASS
          )}
        >
          <X className="h-3 w-3" />
          清除
        </button>
      )}
    </div>
  );
}
