import * as React from "react"
import { Input } from "@/components/ui/input"

export interface PhoneInputProps
  extends Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> {
  value: string | undefined | null
  onChange: (value: string) => void
}

// Formats as (11) 99999-9999 for an 11-digit mobile number, or
// (11) 9999-9999 for a 10-digit landline number, while typing.
function formatBRPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 11)
  const len = digits.length
  if (len === 0) return ""
  if (len <= 2) return `(${digits}`
  if (len <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (len <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

// QA #3: the phone field previously had no mask at all — just a placeholder
// showing the expected format. This applies the format as the user types.
export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ value, onChange, placeholder, ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(formatBRPhone(e.target.value))
    }

    return (
      <Input
        {...props}
        ref={ref}
        type="tel"
        inputMode="numeric"
        autoComplete="tel"
        placeholder={placeholder ?? "(11) 99999-9999"}
        value={value ?? ""}
        onChange={handleChange}
      />
    )
  }
)
PhoneInput.displayName = "PhoneInput"
