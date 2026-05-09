import type { ReactNode } from "react";
import Link from "next/link";
import { Activity, BarChart2, Check, Music, Volume2, X } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { QuickStartTabs } from "@/components/quick-start-tabs";

export default function Page() {
  return (
    <main>
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-12 py-12 lg:py-16 items-center">
        <div>
          <h1 className="font-sans text-5xl lg:text-6xl font-normal leading-tight tracking-tight mb-6">
            Audio intelligence.
            <br />
            <span className="text-primary">No paywalls.</span>
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed mb-8 max-w-md">
            An open-source, drop-in replacement for the Spotify Audio Features
            API. Self-hostable, zero tracking, and infinitely scalable for
            developer-native workflows.
          </p>
          <div className="flex items-center gap-4 flex-wrap">
            <Link
              href="/dashboard"
              className={buttonVariants({ variant: "default", size: "lg" })}
            >
              Get Started
            </Link>
            <Link
              href="https://github.com/sklyerx/audioscape"
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              View on GitHub
            </Link>
          </div>
        </div>
        <TerminalBlock />
      </section>

      <hr className="border-border -mx-10" />

      <section className="py-16">
        <h2 className="font-sans text-3xl lg:text-4xl font-normal mb-10">
          Surgical Precision Audio Metrics
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <FeatureCard
            icon={<Activity className="size-5" />}
            title="BPM & Tempo"
            description="Millisecond-accurate beat tracking and tempo estimation algorithms."
          />
          <FeatureCard
            icon={<Music className="size-5" />}
            title="Key & Mode"
            description="Advanced harmonic analysis determining the musical key and major/minor scale."
          />
          <FeatureCard
            icon={<Volume2 className="size-5" />}
            title="Energy & Loudness"
            description="LUFS measurement and acoustic energy profiling for track mastering."
          />
          <FeatureCard
            icon={<BarChart2 className="size-5" />}
            title="Instrumentalness"
            description={`Predicts whether a track contains no vocals. "Ooh" and "aah" sounds are treated as instrumental.`}
          />
        </div>
      </section>

      <hr className="border-border -mx-10" />

      <section className="py-16 grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
        <div>
          <h2 className="font-sans text-3xl lg:text-4xl font-normal mb-4">
            Evolution of Audio APIs
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-8">
            As the industry consolidates and legacy platforms close their doors,
            developer freedom is compromised. Audioscape provides an escape
            hatch built on open standards.
          </p>
          <ul className="space-y-3">
            <li className="flex items-center gap-2 text-sm">
              <Check className="size-4 text-primary shrink-0" />
              Infinite scalability
            </li>
            <li className="flex items-center gap-2 text-sm">
              <Check className="size-4 text-primary shrink-0" />
              Zero data tracking
            </li>
          </ul>
        </div>

        <div className="rounded-lg border border-border overflow-hidden">
          <div className="grid grid-cols-2 divide-x divide-border">
            <div className="px-6 py-4 border-b border-border">
              <span className="text-sm text-muted-foreground">Legacy APIs</span>
            </div>
            <div className="px-6 py-4 border-b border-border">
              <span className="text-sm font-medium">Audioscape</span>
            </div>
            <div className="px-6 py-5 space-y-4">
              {[
                "Deprecated Features",
                "Paywalled Tiers",
                "Opaque Algorithms",
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <X className="size-4 text-destructive shrink-0" />
                  {item}
                </div>
              ))}
            </div>
            <div className="px-6 py-5 space-y-4">
              {["Actively Maintained", "Open Source Core", "Self-Hostable"].map(
                (item) => (
                  <div key={item} className="flex items-center gap-2 text-sm">
                    <Check className="size-4 text-primary shrink-0" />
                    {item}
                  </div>
                ),
              )}
            </div>
          </div>
        </div>
      </section>

      <hr className="border-border -mx-10" />

      <section className="py-16 text-center">
        <h2 className="font-sans text-3xl lg:text-4xl font-normal mb-4">
          Integrated in seconds
        </h2>
        <p className="text-muted-foreground mb-10 max-w-lg mx-auto">
          Native SDKs for modern backend stacks. No complex auth handshakes
          required.
        </p>
        <div className="max-w-2xl mx-auto text-left">
          <QuickStartTabs />
        </div>
      </section>

      <footer className="border-t border-border -mx-10 px-10 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        <div>
          <p className="font-semibold mb-1">Audioscape</p>
          <p className="text-sm text-muted-foreground">
            © 2024 Audioscape. Open-source under MIT License.
          </p>
        </div>
        <nav>
          <Link
            href="/docs"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Documentation
          </Link>
        </nav>
      </footer>
    </main>
  );
}

function TerminalBlock() {
  return (
    <div className="rounded-lg border border-border bg-muted overflow-hidden font-mono text-sm">
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-border bg-card">
        <span className="size-3 rounded-full bg-destructive/50" />
        <span className="size-3 rounded-full bg-muted-foreground/30" />
        <span className="size-3 rounded-full bg-muted-foreground/30" />
        <span className="ml-2 text-xs text-muted-foreground">terminal</span>
      </div>
      <div className="p-4 leading-relaxed">
        <p className="text-muted-foreground">
          {"$ curl -X GET "}
          <span className="text-foreground">
            {
              '"https://a.audioscape.skylerx.ir/api/audio/analysis/11dFghVXANMlKmJXsNCbNl"'
            }
          </span>
        </p>
        <p className="mt-4">{"{"}</p>
        <div className="pl-4 space-y-0.5">
          {[
            ['"id"', '"11dFghVXANMlKmJXsNCbNl"', true],
            ['"tempo"', "120.04", true],
            ['"key"', "5", true],
            ['"mode"', "1", true],
            ['"energy"', "0.812", true],
            ['"danceability"', "0.67", true],
            ['"instrumentalness"', "0.00004", true],
            ['"duration_ms"', "214500", false],
          ].map(([key, val, comma]) => (
            <p key={String(key)}>
              <span className="text-primary">{key}</span>:{" "}
              <span className="text-foreground">{val}</span>
              {comma ? "," : ""}
            </p>
          ))}
        </div>
        <p>{"}"}</p>
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-3">
      <div className="text-muted-foreground">{icon}</div>
      <h3 className="font-medium text-sm">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">
        {description}
      </p>
    </div>
  );
}
