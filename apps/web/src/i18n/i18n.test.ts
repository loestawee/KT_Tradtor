import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { translate, useLocaleStore, useT } from "./index";
import { th } from "./th";

describe("i18n", () => {
  afterEach(() => {
    useLocaleStore.getState().setLocale("en");
  });

  it("returns English source text when locale is en", () => {
    useLocaleStore.getState().setLocale("en");
    expect(translate("Export")).toBe("Export");
  });

  it("returns Thai text when locale is th", () => {
    useLocaleStore.getState().setLocale("th");
    expect(translate("Export")).toBe("ส่งออก");
    expect(document.documentElement.lang).toBe("th");
  });

  it("falls back to English for untranslated strings", () => {
    useLocaleStore.getState().setLocale("th");
    expect(translate("Some brand new label")).toBe("Some brand new label");
  });

  it("fills {placeholders} in both languages", () => {
    useLocaleStore.getState().setLocale("th");
    expect(translate("Go to step {n}", { n: 3 })).toBe("ไปขั้นที่ 3");
    useLocaleStore.getState().setLocale("en");
    expect(translate("Go to step {n}", { n: 3 })).toBe("Go to step 3");
  });

  it("useT re-renders with the new language", () => {
    useLocaleStore.getState().setLocale("en");
    const { result } = renderHook(() => useT());
    expect(result.current("Media")).toBe("Media");
    act(() => useLocaleStore.getState().setLocale("th"));
    expect(result.current("Media")).toBe("สื่อ");
  });

  it("keeps every placeholder from the English key in the Thai text", () => {
    for (const [en, thai] of Object.entries(th)) {
      const placeholders = en.match(/\{\w+\}/g) ?? [];
      for (const p of placeholders) expect(thai, en).toContain(p);
    }
  });
});
