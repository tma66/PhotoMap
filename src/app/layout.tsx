import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PhotoMap",
  description: "Follow the trip.",
  appleWebApp: {
    capable: true,
    title: "PhotoMap",
    // Opaque: on iOS 26, "black-translucent" blurs the top of the installed
    // app and sizes it one status bar short, leaving a white band at the
    // bottom (WebKit bug 301108). Safari ignores this setting.
    statusBarStyle: "black",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#00293d",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* TEMPORARY: reports browser errors to /api/client-log. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){function send(k,m){try{navigator.sendBeacon("/api/client-log",JSON.stringify({k:k,m:String(m).slice(0,3000),p:location.pathname,t:Date.now()}))}catch(e){}}
window.addEventListener("error",function(e){send("error",(e.error&&e.error.stack)||e.message)});
window.addEventListener("unhandledrejection",function(e){send("rejection",(e.reason&&e.reason.stack)||e.reason)});
var ce=console.error;console.error=function(){send("console",Array.prototype.map.call(arguments,function(a){return a&&a.stack||a}).join(" "));return ce.apply(console,arguments)};
document.addEventListener("visibilitychange",function(){send("visibility",document.visibilityState)});
window.addEventListener("pagehide",function(){send("pagehide","")});
})();`,
          }}
        />
      </head>
      <body>
        <div id="app-shell">{children}</div>
      </body>
    </html>
  );
}
