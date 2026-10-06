"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    __preloadAsFixInitialized?: boolean;
  }
}

function inferAsFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, window.location.origin);
    const path = url.pathname.toLowerCase();
    if (path.endsWith(".js") || path.endsWith(".mjs")) return "script";
    if (path.endsWith(".css")) return "style";
    if (path.endsWith(".woff2") || path.endsWith(".woff") || path.endsWith(".ttf") || path.endsWith(".otf")) return "font";
    if (
      path.endsWith(".png") ||
      path.endsWith(".jpg") ||
      path.endsWith(".jpeg") ||
      path.endsWith(".gif") ||
      path.endsWith(".webp") ||
      path.endsWith(".svg") ||
      path.endsWith(".ico") ||
      path.endsWith(".bmp") ||
      path.endsWith(".avif")
    ) {
      return "image";
    }
    if (path.endsWith(".mp4") || path.endsWith(".webm") || path.endsWith(".ogg")) return "video";
    if (path.endsWith(".mp3") || path.endsWith(".wav") || path.endsWith(".flac")) return "audio";
    if (path.endsWith(".pdf")) return "document";
  } catch (error) {
    return null;
  }
  return null;
}

function applyAsAttribute(link: HTMLLinkElement | null) {
  if (!link || link.rel !== "preload") return;
  const current = link.getAttribute("as");
  if (current && current.trim().length > 0) return;

  const inferred = inferAsFromHref(link.getAttribute("href"));
  if (inferred) {
    link.setAttribute("as", inferred);
  }
}

function applyToNode(node: Node | null) {
  if (!node) return;
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as HTMLElement;
    if (element.tagName === "LINK") {
      applyAsAttribute(element as HTMLLinkElement);
      return;
    }
    element.querySelectorAll("link[rel='preload']").forEach((link) => {
      applyAsAttribute(link as HTMLLinkElement);
    });
  }
}

export default function PreloadAsFix() {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return undefined;
    }

    if (window.__preloadAsFixInitialized) {
      return undefined;
    }
    window.__preloadAsFixInitialized = true;

    const initialLinks = document.querySelectorAll<HTMLLinkElement>("link[rel='preload']");
    initialLinks.forEach((link) => applyAsAttribute(link));

    if (typeof MutationObserver === "undefined") {
      return undefined;
    }

    const target = document.head || document.documentElement;
    if (!target) {
      return undefined;
    }

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "attributes" && mutation.target instanceof HTMLLinkElement) {
          applyAsAttribute(mutation.target);
          return;
        }
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach((node) => {
            applyToNode(node);
          });
        }
      });
    });

    observer.observe(target, {
      attributes: true,
      attributeFilter: ["rel", "href", "as"],
      childList: true,
      subtree: true,
    });

    const disconnect = () => {
      observer.disconnect();
      window.removeEventListener("beforeunload", disconnect);
      window.removeEventListener("pagehide", disconnect);
    };

    window.addEventListener("beforeunload", disconnect);
    window.addEventListener("pagehide", disconnect);

    return () => {
      disconnect();
    };
  }, []);

  return null;
}
