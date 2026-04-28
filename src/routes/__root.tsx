import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">Page not found.</p>
        <Link to="/" className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Go home</Link>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "GFX Compliance — Ongoing Monitoring" },
      { name: "description", content: "Global Foreign Exchange compliance dashboard. Upload monthly transactions, run rule-based screening (CTR/SDA/IFTR), and export reports." },
      { property: "og:title", content: "GFX Compliance — Ongoing Monitoring" },
      { name: "twitter:title", content: "GFX Compliance — Ongoing Monitoring" },
      { property: "og:description", content: "Global Foreign Exchange compliance dashboard. Upload monthly transactions, run rule-based screening (CTR/SDA/IFTR), and export reports." },
      { name: "twitter:description", content: "Global Foreign Exchange compliance dashboard. Upload monthly transactions, run rule-based screening (CTR/SDA/IFTR), and export reports." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/d5f392e2-5058-4e3f-a38d-849a93e1ca19/id-preview-ea12ebe5--8bc8ed8a-4b7c-4e2d-8360-3b938408a572.lovable.app-1777366647886.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/d5f392e2-5058-4e3f-a38d-849a93e1ca19/id-preview-ea12ebe5--8bc8ed8a-4b7c-4e2d-8360-3b938408a572.lovable.app-1777366647886.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Source+Sans+3:wght@300;400;500;600;700&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: () => (<><Outlet /><Toaster richColors position="top-right" /></>),
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}
