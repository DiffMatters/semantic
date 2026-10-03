import type { Metadata } from "next";
import { Workbench } from "@/components/workbench";

export const metadata: Metadata = {
  title: "Config Diff",
  description:
    "Compare JSON, YAML and .env configs side by side: semantic diff with loose matching, array strategies, ignore rules and secret masking. Runs entirely in your browser.",
};

export default function Page() {
  return <Workbench />;
}
