"use client";

import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import Galaxy from "@/components/ui/galaxy";
import { cn } from "@/lib/utils";

export function Hero({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex size-full flex-col items-center justify-center",
        className,
      )}
    >
      <div className="absolute inset-0 z-0 bg-black/40">
        <Galaxy
          mouseRepulsion={false}
          starSpeed={0.2}
          density={0.6}
          glowIntensity={0.35}
          twinkleIntensity={0.3}
          speed={0.5}
        />
      </div>
      <div className="container-md relative z-10 mx-auto flex h-screen flex-col items-center justify-center">
        <h1 className="text-4xl font-bold md:text-7xl">
          TalonFlow
        </h1>
        <p
          className="mt-6 text-center text-xl md:text-2xl text-shadow-sm font-medium tracking-wide"
          style={{ color: "rgb(200, 200, 210)" }}
        >
          Autonomous Recruitment & Strategy Swarm.
        </p>
        <Link href="/workspace">
          <Button className="size-lg mt-8 scale-108" size="lg">
            <span className="text-md">Get Started with 2.0</span>
            <ChevronRightIcon className="size-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
