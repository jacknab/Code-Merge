import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { SEO_CONFIG } from "@/lib/seoConfig";

export default function SeoManager() {
  const location = useLocation();

  useEffect(() => {
    const seo = SEO_CONFIG[location.pathname];
    if (!seo) return;

    document.title = seo.title;

    const setMeta = (name: string, content: string) => {
      let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement("meta");
        el.name = name;
        document.head.appendChild(el);
      }
      el.content = content;
    };

    const setOg = (property: string, content: string) => {
      let el = document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("property", property);
        document.head.appendChild(el);
      }
      el.content = content;
    };

    const setCanonical = (href: string) => {
      let el = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
      if (!el) {
        el = document.createElement("link");
        el.rel = "canonical";
        document.head.appendChild(el);
      }
      el.href = href;
    };

    setMeta("description", seo.description);
    setOg("og:title", seo.title);
    setOg("og:description", seo.description);
    setOg("og:url", seo.canonical);
    setCanonical(seo.canonical);
  }, [location.pathname]);

  return null;
}
