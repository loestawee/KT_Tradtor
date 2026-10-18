import React, { useCallback, useMemo, useRef, useState } from "react";
import { Puzzle, Trash2, Upload, Sparkles } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftSwitchControl } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { useT } from "../../../i18n";
import { toast } from "../../../stores/notification-store";
import { getLoadedPlugins, usePluginStore, type PluginInstallResult } from "../../../stores/plugin-store";
import sampleFilmPack from "../../../plugins/samples/kt-film-pack.ktfx.json?raw";

const MAX_FILE_BYTES = 1_000_000;

export const PluginsPanel: React.FC = () => {
  const t = useT();
  const plugins = usePluginStore((s) => s.plugins);
  const install = usePluginStore((s) => s.install);
  const setEnabled = usePluginStore((s) => s.setEnabled);
  const remove = usePluginStore((s) => s.remove);
  const loaded = useMemo(() => getLoadedPlugins(plugins), [plugins]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const report = useCallback(
    (result: PluginInstallResult) => {
      if (result.ok) {
        setLastError(null);
        toast.success(
          result.replaced ? t("Plugin updated") : t("Plugin installed"),
          t("{name} — {n} effects ready in the Shaders tab", {
            name: result.plugin.manifest.name,
            n: result.plugin.shaders.length,
          }),
        );
      } else {
        setLastError(result.error);
        toast.error(t("Plugin not installed"), result.error);
      }
    },
    [t],
  );

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) {
        report({ ok: false, error: t("The file is larger than 1 MB") });
        return;
      }
      report(install(await file.text()));
    },
    [install, report, t],
  );

  return (
    <div className="space-y-5">
      <div>
        <Text type="body" color="primary" display="block" className="text-sm font-medium">
          {t("Effect & filter plugins")}
        </Text>
        <Text type="supporting" color="secondary" display="block" className="mt-0.5 text-xs">
          {t("Add new effects from .ktfx.json files. Plugins contain GPU shaders only (no scripts), are checked before install, and appear under Effects → Shaders on any clip.")}
        </Text>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          label={t("Install from file…")}
          variant="primary"
          size="sm"
          icon={<Upload size={14} aria-hidden />}
          onClick={() => fileInputRef.current?.click()}
        />
        {!plugins.some((p) => p.id === "kt.film-pack") && (
          <Button
            label={t("Install sample: KT Film Pack")}
            variant="secondary"
            size="sm"
            icon={<Sparkles size={14} aria-hidden />}
            onClick={() => report(install(sampleFilmPack))}
          />
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.ktfx,application/json"
          aria-label={t("Plugin file")}
          className="hidden"
          onChange={(event) => {
            void handleFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>

      {lastError && (
        <div role="alert" className="rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-[11px] text-status-warning">
          {lastError}
        </div>
      )}

      {loaded.length === 0 ? (
        <div className="flex flex-col items-center rounded-lg border border-dashed border-border py-8 text-center">
          <Puzzle size={24} className="mb-2 text-text-muted" aria-hidden />
          <Text type="supporting" color="secondary" display="block" className="text-xs">
            {t("No plugins installed yet")}
          </Text>
        </div>
      ) : (
        <ul className="space-y-2">
          {loaded.map(({ id, enabled, plugin }) => (
            <li key={id} className="flex items-start gap-3 rounded-lg border border-border bg-bg-1 p-3">
              <Puzzle size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="truncate text-sm font-semibold text-fg">{plugin.manifest.name}</span>
                  <span className="text-[11px] text-fg-muted">v{plugin.manifest.version}</span>
                  {plugin.manifest.author && (
                    <span className="truncate text-[11px] text-fg-muted">· {plugin.manifest.author}</span>
                  )}
                </div>
                {plugin.manifest.description && (
                  <p className="mt-0.5 text-xs text-fg-3">{plugin.manifest.description}</p>
                )}
                <p className="mt-1 text-[11px] text-fg-muted">
                  {t("{n} effects", { n: plugin.shaders.length })}: {plugin.shaders.map((s) => s.name).join(", ")}
                </p>
              </div>
              <ToolcraftSwitchControl
                ariaLabel={t("Enable {name}", { name: plugin.manifest.name })}
                showLabel={false}
                checked={enabled}
                onCheckedChange={(next) => setEnabled(id, next)}
              />
              <IconButton
                label={t("Remove plugin")}
                icon={<Trash2 size={14} aria-hidden />}
                variant="ghost"
                size="sm"
                onClick={() => remove(id)}
              />
            </li>
          ))}
        </ul>
      )}

      <Text type="supporting" color="secondary" display="block" className="text-[11px]">
        {t("Clips that use a plugin effect keep a copy of it inside the project, so they still render after the plugin is disabled or on another device.")}
      </Text>
    </div>
  );
};
