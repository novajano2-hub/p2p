"use client";

import { useEffect, useState } from "react";

import { BalanceCard } from "@/components/wallet/balance-card";
import { walletClient, type WalletBalance } from "@/lib/wallet/client";

/*
  Home's balance: the Wallet's own card (components/wallet/balance-card.tsx),
  fed by the same read the wallet page makes, so the two screens cannot show
  the figure two ways.
*/
export function WalletCard({ className }: { className?: string | undefined }) {
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void walletClient.balance().then((result) => {
      if (!live) return;
      if (result.ok) setBalance(result.balance);
      else setProblem(result.message);
    });
    return () => {
      live = false;
    };
  }, [attempt]);

  return (
    <BalanceCard
      balance={balance}
      problem={problem}
      onRetry={() => {
        setProblem(null);
        setAttempt((value) => value + 1);
      }}
      className={className}
    />
  );
}
