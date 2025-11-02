import { Search } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  buttonText?: string;
  onButtonClick?: () => void;
}

export function SearchBar({
  value,
  onChange,
  placeholder = "Search...",
  buttonText,
  onButtonClick,
}: SearchBarProps) {
  return (
    <div className="flex gap-2 shrink-0">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white/40" />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pl-9 bg-black/40 border-white/20"
        />
      </div>
      {buttonText && onButtonClick && (
        <Button onClick={onButtonClick} variant="secondary" size="sm">
          {buttonText}
        </Button>
      )}
    </div>
  );
}
