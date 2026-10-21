"use client";

import {useEffect, useRef} from "react";

/** 页面可见时每分钟刷新，单个页面不重叠发送请求。 */
export function useVisibleRefresh(refresh: () => Promise<unknown>) {
  const currentRefresh = useRef(refresh);
  useEffect(() => { currentRefresh.current = refresh; }, [refresh]);

  useEffect(() => {
    let disposed = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!disposed && document.visibilityState === "visible") {
        timer = setTimeout(() => void run(), 60_000);
      }
    };
    const run = async () => {
      if (disposed || running || document.visibilityState !== "visible") return;
      running = true;
      try { await currentRefresh.current(); }
      catch { /* 本轮请求失败不停止后续刷新。 */ }
      finally { running = false; schedule(); }
    };
    const visibilityChanged = () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible") void run();
    };
    schedule();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, []);
}
