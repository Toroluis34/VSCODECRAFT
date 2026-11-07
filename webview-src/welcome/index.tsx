// Welcome page + "Create Mod Project" generator form.
import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { boot, call, onEvent } from '../shared/vscode';
import { t } from '../shared/i18n';
import { Button } from '../shared/components';
import { STYLE, PICKAXE, LOADER_ICONS } from './assets';

interface WelcomeState {
  tab: 'start' | 'mod';
  versions: { id: string; java: number; fabric: boolean; neoforge: boolean }[];
  defaultVersion: string;
  defaultFolder: string;
  generators: { fabric: string; neoforge: string };
  projects: { name: string; loader: string; version: string }[];
  available: string[];
}

type Loader = 'fabric' | 'neoforge';

const init = boot<WelcomeState>().state ?? {
  tab: 'start',
  versions: [{ id: '26.3', java: 25, fabric: true, neoforge: true }],
  defaultVersion: '26.3',
  defaultFolder: '',
  generators: { fabric: 'https://fabricmc.net/develop/template/', neoforge: 'https://neoforged.net/mod-generator/' },
  projects: [],
  available: [],
};

const LOADER_NAMES: Record<string, string> = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  neoforge: 'NeoForge',
  forge: 'Forge',
  paper: 'Paper',
  datapack: 'Data Pack',
  resourcepack: 'Resource Pack',
  unknown: 'Minecraft',
};

const TOOLS: { command: string; label: string; icon: string }[] = [
  { command: 'vscodecraft.models.newItem', label: 'New Item', icon: '⛏' },
  { command: 'vscodecraft.models.newBlock', label: 'New Block', icon: '▣' },
  { command: 'vscodecraft.recipes.new', label: 'New Recipe', icon: '⚒' },
  { command: 'vscodecraft.recipes.browser', label: 'Recipe Browser', icon: '📖' },
  { command: 'vscodecraft.textures.newTexture', label: 'New Texture', icon: '🎨' },
  { command: 'vscodecraft.translations.openEditor', label: 'Lang Editor', icon: '🌐' },
  { command: 'vscodecraft.loot.advancementTree', label: 'Advancement Tree', icon: '★' },
  { command: 'vscodecraft.loot.itemBuilder', label: 'Item Builder', icon: '✦' },
  { command: 'vscodecraft.datapack.exportZip', label: 'Export Pack', icon: '📦' },
  { command: 'vscodecraft.downloadData', label: 'Download vanilla data', icon: '⇩' },
  { command: 'vscodecraft.selectVersion', label: 'Select Minecraft version', icon: '⚙' },
];

function run(command: string, ...args: unknown[]): void {
  void call('welcome.run', { command, args }).catch((e) => call('ui.notify', { message: String(e?.message ?? e), level: 'error' }));
}

function Icon({ svg, size = 32 }: { svg: string; size?: number }) {
  return <span class="wc-svg" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

function StartTab({ onMod }: { onMod: () => void }) {
  const tools = TOOLS.filter((x) => init.available.includes(x.command));
  return (
    <div class="mc-col wc-start">
      <div class="wc-grid">
        <button class="wc-card" onClick={() => run('vscodecraft.explorer.createDatapack')}>
          <Icon svg={LOADER_ICONS.datapack} size={40} />
          <div>
            <div class="wc-card-title">{t('Create Datapack')}</div>
            <div class="mc-muted">{t('pack.mcmeta with the right format, load/tick functions, pack.png and README.')}</div>
          </div>
        </button>
        <button class="wc-card" onClick={() => run('vscodecraft.explorer.createResourcePack')}>
          <Icon svg={LOADER_ICONS.resourcepack} size={40} />
          <div>
            <div class="wc-card-title">{t('Create Resource Pack')}</div>
            <div class="mc-muted">{t('Textures, models and translations for any version from 1.21 to 26.x.')}</div>
          </div>
        </button>
        <button class="wc-card" onClick={onMod}>
          <Icon svg={LOADER_ICONS.mod} size={40} />
          <div>
            <div class="wc-card-title">{t('Create Mod Project')}</div>
            <div class="mc-muted">{t('Minimal Fabric or NeoForge skeleton, or jump to the official generators.')}</div>
          </div>
        </button>
      </div>

      <h3>{t('Projects in this workspace')}</h3>
      {init.projects.length ? (
        <div class="wc-projects">
          {init.projects.map((p) => (
            <div class="wc-project mc-card" key={p.name}>
              <Icon svg={LOADER_ICONS[p.loader] ?? LOADER_ICONS.mod} size={24} />
              <b>{p.name}</b>
              <span class="mc-badge">{LOADER_NAMES[p.loader] ?? p.loader}</span>
              <span class="mc-muted">Minecraft {p.version}</span>
            </div>
          ))}
        </div>
      ) : (
        <div class="mc-muted">
          {t('No Minecraft project detected. Open a mod or pack folder, or create one above.')}{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), run('vscodecraft.explorer.refresh'))}>
            {t('Re-detect')}
          </a>
        </div>
      )}

      {tools.length ? (
        <>
          <h3>{t('Tools')}</h3>
          <div class="wc-tools">
            {tools.map((x) => (
              <Button key={x.command} secondary icon={x.icon} onClick={() => run(x.command)}>
                {t(x.label)}
              </Button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function ModTab() {
  const [loader, setLoader] = useState<Loader>('fabric');
  const [version, setVersion] = useState(init.defaultVersion);
  const [modName, setModName] = useState('My Mod');
  const [modId, setModId] = useState('mymod');
  const [idTouched, setIdTouched] = useState(false);
  const [pkg, setPkg] = useState('com.example.mymod');
  const [pkgTouched, setPkgTouched] = useState(false);
  const [author, setAuthor] = useState('');
  const [description, setDescription] = useState('');
  const [license, setLicense] = useState('MIT');
  const [example, setExample] = useState(true);
  const [folder, setFolder] = useState(init.defaultFolder);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const v = init.versions.find((x) => x.id === version) ?? init.versions[0];
  const known = v ? (loader === 'fabric' ? v.fabric : v.neoforge) : false;
  const idOk = /^[a-z][a-z0-9_]{1,63}$/.test(modId);
  const pkgOk = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$/.test(pkg);

  useEffect(() => {
    if (!idTouched) {
      const id = modName
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^[^a-z]+|_+$/g, '')
        .slice(0, 64);
      setModId(id || 'mymod');
    }
  }, [modName]);
  useEffect(() => {
    if (!pkgTouched) setPkg(`com.example.${modId.replace(/[^a-z0-9_]/g, '') || 'mymod'}`);
  }, [modId]);

  const files = useMemo(() => {
    const p = pkg.replace(/\./g, '/');
    const main = modId.split('_').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : '')).join('') || 'Mod';
    return loader === 'fabric'
      ? ['gradle.properties', 'settings.gradle', 'build.gradle', 'src/main/resources/fabric.mod.json', `src/main/resources/${modId}.mixins.json`, `src/main/java/${p}/${main}.java`, `src/main/java/${p}/mixin/ExampleMixin.java`, `src/client/java/${p}/client/${main}Client.java`]
      : ['gradle.properties', 'settings.gradle', 'build.gradle', 'src/main/templates/META-INF/neoforge.mods.toml', `src/main/java/${p}/${main}.java`];
  }, [loader, modId, pkg]);

  const generate = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await call<{ folder: string }>('welcome.generateMod', {
        folder,
        options: { loader, mcVersion: version, modId, modName, packageName: pkg, author, description: description || modName, license, exampleItem: example },
      });
      setResult({ ok: true, text: t('Project created in {0}', r.folder) });
    } catch (e: any) {
      setResult({ ok: false, text: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="wc-mod">
      <div class="wc-warning">
        <b>⚠ {t('Prefer the official generators')}</b>
        <p>
          {t('This generator creates a minimal skeleton. Loader, Gradle plugin and API versions change often: check every version in gradle.properties before building. The official generators always produce an up-to-date project with the Gradle wrapper.')}
        </p>
        <div class="mc-row">
          <Button icon="↗" onClick={() => call('welcome.openUrl', { url: init.generators.fabric })}>
            {t('Fabric template generator')}
          </Button>
          <Button icon="↗" onClick={() => call('welcome.openUrl', { url: init.generators.neoforge })}>
            {t('NeoForge mod generator')}
          </Button>
        </div>
      </div>

      <div class="wc-form">
        <div class="wc-field-row">
          <span class="wc-label">{t('Loader')}</span>
          <div class="wc-loaders">
            {(['fabric', 'neoforge'] as Loader[]).map((l) => (
              <button key={l} class={`wc-loader ${loader === l ? 'active' : ''}`} onClick={() => setLoader(l)} aria-pressed={loader === l}>
                <Icon svg={LOADER_ICONS[l]} size={22} />
                {LOADER_NAMES[l]}
              </button>
            ))}
          </div>
        </div>
        <label class="wc-field-row">
          <span class="wc-label">{t('Minecraft version')}</span>
          <span class="mc-row">
            <select class="mc-select" value={version} onChange={(e) => setVersion((e.target as HTMLSelectElement).value)}>
              {init.versions.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.id}
                </option>
              ))}
            </select>
            <span class="mc-badge">Java {v?.java ?? 21}+</span>
            {!known ? <span class="mc-warning">{t('Loader versions unknown for {0}: they will be guessed', version)}</span> : null}
          </span>
        </label>
        <label class="wc-field-row">
          <span class="wc-label">{t('Mod name')}</span>
          <input class="mc-input" value={modName} onInput={(e) => setModName((e.target as HTMLInputElement).value)} />
        </label>
        <label class="wc-field-row">
          <span class="wc-label">{t('Mod id')}</span>
          <span class="mc-col wc-grow">
            <input
              class={`mc-input mono ${idOk ? '' : 'wc-invalid'}`}
              value={modId}
              onInput={(e) => {
                setIdTouched(true);
                setModId((e.target as HTMLInputElement).value);
              }}
            />
            {!idOk ? <span class="mc-error">{t('2–64 characters: lowercase letters, digits and _, starting with a letter')}</span> : null}
          </span>
        </label>
        <label class="wc-field-row">
          <span class="wc-label">{t('Java package')}</span>
          <span class="mc-col wc-grow">
            <input
              class={`mc-input mono ${pkgOk ? '' : 'wc-invalid'}`}
              value={pkg}
              onInput={(e) => {
                setPkgTouched(true);
                setPkg((e.target as HTMLInputElement).value);
              }}
            />
            {!pkgOk ? <span class="mc-error">{t('Invalid Java package')}</span> : null}
          </span>
        </label>
        <label class="wc-field-row">
          <span class="wc-label">{t('Author')}</span>
          <input class="mc-input" value={author} onInput={(e) => setAuthor((e.target as HTMLInputElement).value)} />
        </label>
        <label class="wc-field-row">
          <span class="wc-label">{t('Description')}</span>
          <input class="mc-input" value={description} placeholder={modName} onInput={(e) => setDescription((e.target as HTMLInputElement).value)} />
        </label>
        <label class="wc-field-row">
          <span class="wc-label">{t('License')}</span>
          <input class="mc-input" value={license} onInput={(e) => setLicense((e.target as HTMLInputElement).value)} />
        </label>
        <label class="wc-field-row">
          <span class="wc-label" />
          <span class="mc-row">
            <input type="checkbox" checked={example} onChange={(e) => setExample((e.target as HTMLInputElement).checked)} />
            {t('Add an example item (ruby) with model, texture and translation')}
          </span>
        </label>
        <div class="wc-field-row">
          <span class="wc-label">{t('Destination folder')}</span>
          <span class="mc-row wc-grow">
            <input class="mc-input wc-grow mono" value={folder} onInput={(e) => setFolder((e.target as HTMLInputElement).value)} />
            <Button
              secondary
              onClick={async () => {
                const f = await call<string | null>('welcome.pickFolder', { current: folder });
                if (f) setFolder(f);
              }}
            >
              {t('Browse…')}
            </Button>
          </span>
        </div>
        <div class="wc-field-row">
          <span class="wc-label" />
          <span class="mc-muted">{t('The project will be created in {0}', `${folder || '…'}/${modId}`)}</span>
        </div>
      </div>

      <details class="wc-files">
        <summary>{t('Files that will be generated')}</summary>
        <ul class="mono">
          {files.map((f) => (
            <li key={f}>{f}</li>
          ))}
          <li>src/main/resources/assets/{modId}/…</li>
          <li>README.md, .gitignore</li>
        </ul>
      </details>

      <div class="mc-row wc-actions">
        <button class="mc-button" disabled={busy || !idOk || !pkgOk || !folder} onClick={generate}>
          <span class="mc-button-icon">⛏</span>
          {busy ? t('Generating…') : t('Generate project')}
        </button>
        {result ? <span class={result.ok ? 'wc-ok' : 'mc-error'}>{result.text}</span> : null}
      </div>
    </div>
  );
}

function App() {
  const [tab, setTab] = useState<'start' | 'mod'>(init.tab);
  useEffect(() => onEvent<'start' | 'mod'>('welcome.tab', (x) => setTab(x)), []);
  return (
    <div class="wc-root">
      <style>{STYLE}</style>
      <header class="wc-header">
        <Icon svg={PICKAXE} size={44} />
        <div>
          <h1>VSCodeCraft</h1>
          <div class="mc-muted">{t('Minecraft Java modding toolkit — Fabric, NeoForge, datapacks and resource packs (1.21 – 26.x)')}</div>
        </div>
      </header>
      <div class="mc-tabs">
        <button class={`mc-tab ${tab === 'start' ? 'active' : ''}`} onClick={() => setTab('start')}>
          {t('Start')}
        </button>
        <button class={`mc-tab ${tab === 'mod' ? 'active' : ''}`} onClick={() => setTab('mod')}>
          {t('New mod project')}
        </button>
      </div>
      {tab === 'start' ? <StartTab onMod={() => setTab('mod')} /> : <ModTab />}
    </div>
  );
}

render(<App />, document.getElementById('app')!);
