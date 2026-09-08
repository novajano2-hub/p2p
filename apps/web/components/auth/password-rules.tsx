"use client";

import { CheckCircle, Circle } from "@phosphor-icons/react";

import { passwordRules } from "@/lib/auth/schemas";
import { cn } from "@/lib/cn";

/** Live checklist under the password field. Each rule ticks as it is met. */
export function PasswordRules({ value }: { value: string }) {
  return (
    <ul className="mt-3 flex flex-col gap-1.5" aria-live="polite">
      {passwordRules.map((rule) => {
        const met = rule.test(value);
        return (
          <li
            key={rule.id}
            className={cn(
              "flex items-center gap-2 text-[13px] transition-colors duration-150",
              met ? "text-status-complete-fg" : "text-muted-foreground",
            )}
          >
            {met ? (
              <CheckCircle size={15} weight="fill" aria-hidden="true" />
            ) : (
              <Circle size={15} aria-hidden="true" />
            )}
            <span>{rule.label}</span>
            <span className="sr-only">{met ? ", met" : ", not yet"}</span>
          </li>
        );
      })}
    </ul>
  );
}
