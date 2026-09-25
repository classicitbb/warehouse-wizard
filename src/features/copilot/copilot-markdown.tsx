// The markdown stack (unified, micromark, GFM) is ~150 kB. It lives in its own
// chunk so the app shell, which mounts the copilot panel on every page, does not
// download it until an assistant answer is actually on screen.
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function CopilotMarkdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>;
}
