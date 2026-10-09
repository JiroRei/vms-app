import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Visitor Management System",
  description: "Manage visitors, appointments, and check-ins",
};

/**
 * Applies the saved theme while the browser is still parsing the HTML, before
 * anything is painted.
 *
 * The server has no way to know the preference — it lives in `localStorage` —
 * so it renders light, and without this a dark-mode user got a white flash on
 * every hard navigation. `ThemeProvider` reads the same key in its lazy state
 * initializer, so React's state and the class on `<html>` always agree.
 *
 * Only an explicitly stored value is honoured; with nothing stored the page
 * stays light, which is what the toggle has always defaulted to.
 */
const applyStoredTheme = `(function(){try{if(localStorage.getItem("vms-theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: applyStoredTheme }} />
      </head>
      <body className="min-h-full flex flex-col bg-gray-50 text-gray-900 font-sans">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
