"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const tabs = [
  {
    label: "Node.js",
    code: `const response = await fetch(
  "https://a.audioscape.skylerx.ir/api/audio/analysis/11dFghVXANMlKmJXsNCbNl",
  {
    headers: {
      Authorization: "Bearer YOUR_API_KEY",
    },
  }
);

const features = await response.json();
console.log(features.tempo); // 120.04`,
  },
  {
    label: "Python",
    code: `import requests

response = requests.get(
    "https://a.audioscape.skylerx.ir/api/audio/analysis/11dFghVXANMlKmJXsNCbNl",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
)

features = response.json()
print(features["tempo"])  # 120.04`,
  },
];

export function QuickStartTabs() {
  const [active, setActive] = useState(0);

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex border-b border-border bg-card">
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            type="button"
            onClick={() => setActive(i)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer",
              active === i
                ? "text-foreground border-b-2 border-primary -mb-px bg-card"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <pre className="p-5 text-sm font-mono overflow-x-auto bg-muted leading-relaxed">
        <code className="text-foreground">{tabs[active].code}</code>
      </pre>
    </div>
  );
}
