import * as React from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export interface CurrencyInputProps
  extends Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> {
  value: number | undefined | null
  onChange: (value: number | undefined) => void
}

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// Money input for Brazilian Real values (salary, mensalidade, despesas, ...).
// A plain <input type="number"> can't take a comma as the decimal separator
// (QA #3) and re-parsing the formatted text on every keystroke makes the
// cursor jump and breaks mid-string edits / Ctrl+A+Delete (QA #4).
//
// This component sidesteps both: every keystroke is read as raw digits only
// (like typing on a calculator/POS terminal — the rightmost two digits are
// always the cents), never as a comma-separated string to parse. Backspace
// always removes the last digit typed, and clearing the field (Ctrl+A+Delete)
// naturally produces an empty digit string, which maps to `undefined`.
export const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ value, onChange, className, placeholder, ...props }, ref) => {
    const displayValue = value === undefined || value === null ? "" : formatBRL(value)

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const digitsOnly = e.target.value.replace(/\D/g, "")
      if (digitsOnly === "") {
        onChange(undefined)
        return
      }
      const cents = parseInt(digitsOnly, 10)
      onChange(cents / 100)
    }

    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          R$
        </span>
        <Input
          {...props}
          ref={ref}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className={cn("pl-9", className)}
          placeholder={placeholder ?? "0,00"}
          value={displayValue}
          onChange={handleChange}
        />
      </div>
    )
  }
)
CurrencyInput.displayName = "CurrencyInput"
