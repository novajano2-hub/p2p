"use client";

import { Eye, EyeSlash } from "@phosphor-icons/react";
import { useState } from "react";

import { Input, type InputProps } from "@/components/ui/field";
import { cn } from "@/lib/cn";

/** Password control with a reveal toggle. The toggle is a real button with a real name. */
export function PasswordInput({ className, ...props }: Omit<InputProps, "type">) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input type={visible ? "text" : "password"} className={cn("pr-11", className)} {...props} />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="rounded-control text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-11 items-center justify-center transition-colors duration-150"
      >
        {visible ? <EyeSlash size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}
