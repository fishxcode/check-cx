"use client";
import {createContext, useContext, type ReactNode} from "react";
import type {MonitoringSnapshot} from "@/lib/types/monitoring";

const DisplayContext = createContext<{showSla: boolean; available: boolean; descriptions: Record<string, string>; modelGroups: Record<string, string[]>}>({showSla: true, available: true, descriptions: {}, modelGroups: {}});
export const useMonitoringDisplay = () => useContext(DisplayContext);
export function MonitoringDisplayProvider({snapshot, descriptions = {}, modelGroups = {}, children}: {snapshot?: MonitoringSnapshot; descriptions?: Record<string, string>; modelGroups?: Record<string, string[]>; children: ReactNode}) {
  return <DisplayContext.Provider value={{showSla: snapshot?.showSla !== false, available: snapshot?.available ?? false, descriptions, modelGroups}}>{children}</DisplayContext.Provider>;
}
