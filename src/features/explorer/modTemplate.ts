// "Create Mod Project" generator: minimal Fabric / NeoForge project skeletons (pure: no 'vscode' import).
// Versions below were taken from the official templates (fabric-example-mod branches, NeoForge MDKs).
// They WILL go stale: every generated gradle.properties marks them clearly so users check them.
import { atLeast, compareVersions, getFeatures } from '../../core/versions';
import { encodePng, placeholderTexture, packIcon } from './png';

export type ModLoaderKind = 'fabric' | 'neoforge';

export interface ModProjectOptions {
  loader: ModLoaderKind;
  mcVersion: string;
  modId: string;
  modName: string;
  /** Java package / maven group, e.g. "com.example.mymod". */
  packageName: string;
  author: string;
  description: string;
  license: string;
  /** Add an example item (ruby) with model, texture, lang and creative tab entry. */
  exampleItem: boolean;
}

/** Known Fabric API versions per Minecraft version (fabric-example-mod branches). */
export const FABRIC_API_VERSIONS: Record<string, string> = {
  '1.21': '0.102.0+1.21',
  '1.21.1': '0.116.17+1.21.1',
  '1.21.2': '0.106.1+1.21.2',
  '1.21.3': '0.114.1+1.21.3',
  '1.21.4': '0.119.4+1.21.4',
  '1.21.5': '0.128.2+1.21.5',
  '1.21.6': '0.128.2+1.21.6',
  '1.21.7': '0.129.0+1.21.7',
  '1.21.8': '0.136.1+1.21.8',
  '1.21.9': '0.134.1+1.21.9',
  '1.21.10': '0.138.4+1.21.10',
  '1.21.11': '0.141.6+1.21.11',
  '26.1': '0.145.1+26.1',
  '26.1.2': '0.155.3+26.1.2',
  '26.2': '0.161.0+26.2',
  '26.3': '0.165.0+26.3',
};
export const FABRIC_LOADER_VERSION = '0.20.1';
export const FABRIC_LOOM_VERSION = '1.19-SNAPSHOT';

/** Known NeoForge versions per Minecraft version (NeoForge MDKs). */
export const NEOFORGE_VERSIONS: Record<string, string> = {
  '1.21': '21.0.167',
  '1.21.1': '21.1.265',
  '1.21.2': '21.2.1-beta',
  '1.21.3': '21.3.100',
  '1.21.4': '21.4.161',
  '1.21.5': '21.5.101',
  '1.21.6': '21.6.20-beta',
  '1.21.7': '21.7.25-beta',
  '1.21.8': '21.8.57',
  '1.21.9': '21.9.16-beta',
  '1.21.10': '21.10.64',
  '1.21.11': '21.11.48',
  '26.1': '26.1.0.19-beta',
  '26.1.1': '26.1.1.15-beta',
  '26.1.2': '26.1.2.126',
  '26.2': '26.2.0.93',
  '26.3': '26.3.0.101',
};
export const MODDEV_PLUGIN_VERSION = '2.0.148';
/** Parchment mappings (only before 26.1: the game ships unobfuscated since then). */
export const PARCHMENT_VERSIONS: Record<string, [string, string]> = {
  '1.21': ['1.21', '2024.11.10'],
  '1.21.1': ['1.21.1', '2024.11.17'],
  '1.21.3': ['1.21.3', '2024.12.07'],
  '1.21.4': ['1.21.4', '2025.03.23'],
  '1.21.5': ['1.21.5', '2025.06.15'],
  '1.21.6': ['1.21.6', '2025.06.29'],
  '1.21.7': ['1.21.7', '2025.07.18'],
  '1.21.8': ['1.21.8', '2025.09.14'],
  '1.21.9': ['1.21.9', '2025.10.05'],
  '1.21.10': ['1.21.10', '2025.10.12'],
  '1.21.11': ['1.21.11', '2025.12.20'],
};

export const OFFICIAL_GENERATORS = {
  fabric: 'https://fabricmc.net/develop/template/',
  neoforge: 'https://neoforged.net/mod-generator/',
} as const;

/** Look up a version table; when the exact version is unknown, use the closest older entry and flag it. */
export function lookupVersion<T>(table: Record<string, T>, mc: string): { value: T | undefined; exact: boolean } {
  if (mc in table) return { value: table[mc], exact: true };
  const older = Object.keys(table)
    .filter((k) => compareVersions(k, mc) <= 0)
    .sort(compareVersions)
    .pop();
  return { value: older ? table[older] : undefined, exact: false };
}

export function isValidModId(id: string): boolean {
  return /^[a-z][a-z0-9_]{1,63}$/.test(id);
}

export function isValidPackage(pkg: string): boolean {
  return /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$/.test(pkg);
}

/** "my_cool_mod" -> "MyCoolMod" */
export function className(modId: string): string {
  const s = modId
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
  return /^[0-9]/.test(s) ? 'Mod' + s : s || 'ExampleMod';
}

/** Identifier (1.21.11+) or ResourceLocation (older) — the class Mojang mappings use for "ns:path". */
export function idClass(mc: string): 'Identifier' | 'ResourceLocation' {
  return atLeast(mc, '1.21.11') ? 'Identifier' : 'ResourceLocation';
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
const tabs = (s: string) => s.replace(/^( {4})+/gm, (m) => '\t'.repeat(m.length / 4));

/** Generate every file of the project skeleton (relative path -> content). */
export function generateModProject(o: ModProjectOptions): Record<string, string | Uint8Array> {
  const files = o.loader === 'fabric' ? fabricProject(o) : neoforgeProject(o);
  files['.gitignore'] = ['# gradle', '.gradle/', 'build/', 'out/', 'classes/', '', '# idea', '.idea/', '*.iml', '*.ipr', '*.iws', '', '# vscode', '.settings/', '.vscode/', 'bin/', '.classpath', '.project', '', '# macos', '*.DS_Store', '', '# minecraft', 'run/', 'runs/', 'run-data/', ''].join('\n');
  files[`src/main/resources/assets/${o.modId}/icon.png`] = encodePng(packIcon('data', o.modId, 128));
  const lang: Record<string, string> = {};
  if (o.exampleItem) {
    lang[`item.${o.modId}.ruby`] = 'Ruby';
    files[`src/main/resources/assets/${o.modId}/models/item/ruby.json`] = json({ parent: 'minecraft:item/generated', textures: { layer0: `${o.modId}:item/ruby` } });
    if (getFeatures(o.mcVersion).hasItemDefinitions) {
      files[`src/main/resources/assets/${o.modId}/items/ruby.json`] = json({ model: { type: 'minecraft:model', model: `${o.modId}:item/ruby` } });
    }
    files[`src/main/resources/assets/${o.modId}/textures/item/ruby.png`] = encodePng(placeholderTexture(`${o.modId}:ruby`));
  }
  if (o.loader === 'neoforge') lang[`itemGroup.${o.modId}`] = o.modName;
  files[`src/main/resources/assets/${o.modId}/lang/en_us.json`] = json(lang);
  files[`src/main/resources/data/${o.modId}/.gitkeep`] = '';
  files['README.md'] = readme(o);
  return files;
}

function readme(o: ModProjectOptions): string {
  const java = getFeatures(o.mcVersion).javaVersion;
  const gen = OFFICIAL_GENERATORS[o.loader];
  return `# ${o.modName}

${o.description}

${o.loader === 'fabric' ? 'Fabric' : 'NeoForge'} mod for Minecraft ${o.mcVersion} (Java ${java}). Mod id: \`${o.modId}\`.

> **Generated by VSCodeCraft.** This is a minimal skeleton. Loader, plugin and API versions in
> \`gradle.properties\` / \`build.gradle\` must be checked against the official sources before building:
> ${o.loader === 'fabric' ? 'https://fabricmc.net/develop' : 'https://projects.neoforged.net/neoforged/neoforge'}.
> The official generator (${gen}) produces a complete project including the Gradle wrapper.

## Getting started

1. Install JDK ${java}.
2. This skeleton has no Gradle wrapper: run \`gradle wrapper\` once (Gradle 9+), or copy \`gradlew\`, \`gradlew.bat\`
   and \`gradle/wrapper/\` from the official template.
3. \`./gradlew ${o.loader === 'fabric' ? 'runClient' : 'runClient'}\` to start the game, \`./gradlew build\` to build the jar.
`;
}

// ---------------------------------------------------------------- Fabric

function fabricProject(o: ModProjectOptions): Record<string, string | Uint8Array> {
  const f = getFeatures(o.mcVersion);
  const java = f.javaVersion;
  const noRemap = atLeast(o.mcVersion, '26.1');
  const api = lookupVersion(FABRIC_API_VERSIONS, o.mcVersion);
  const apiVersion = api.exact ? api.value! : `${api.value?.split('+')[0] ?? '0.0.0'}+${o.mcVersion}`;
  const cls = className(o.modId);
  const pkgPath = o.packageName.replace(/\./g, '/');
  const files: Record<string, string | Uint8Array> = {};
  const group = o.packageName.split('.').slice(0, -1).join('.') || o.packageName;

  files['gradle.properties'] = `# Done to increase the memory available to gradle.
org.gradle.jvmargs=-Xmx1G
org.gradle.parallel=true

# ---------------------------------------------------------------------------
# !!! CHECK THESE VERSIONS before building: https://fabricmc.net/develop
# (generated by VSCodeCraft${api.exact ? '' : ` — no known Fabric API version for ${o.mcVersion}, this one is a GUESS`})
# ---------------------------------------------------------------------------
minecraft_version=${o.mcVersion}
loader_version=${FABRIC_LOADER_VERSION}
loom_version=${FABRIC_LOOM_VERSION}
fabric_api_version=${apiVersion}

# Mod Properties
mod_version=1.0.0
maven_group=${group}
archives_base_name=${o.modId}
`;

  files['settings.gradle'] = tabs(`pluginManagement {
    repositories {
        maven {
            name = 'Fabric'
            url = 'https://maven.fabricmc.net/'
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

// Should match your mod id
rootProject.name = '${o.modId}'
`);

  const impl = noRemap ? 'implementation' : 'modImplementation';
  files['build.gradle'] = tabs(`plugins {
    // ${noRemap ? 'Minecraft 26.1+ ships unobfuscated: the plain (non-remapping) Loom plugin is used.' : 'Remapping Loom plugin (Minecraft < 26.1 is obfuscated). Older Loom versions use the id "fabric-loom".'}
    id '${noRemap ? 'net.fabricmc.fabric-loom' : 'net.fabricmc.fabric-loom-remap'}' version "\${loom_version}"
    id 'maven-publish'
}

version = project.mod_version
group = project.maven_group

base {
    archivesName = project.archives_base_name
}

repositories {
    // Loom adds the Minecraft and Fabric repositories automatically.
}

loom {
    splitEnvironmentSourceSets()

    mods {
        "${o.modId}" {
            sourceSet sourceSets.main
            sourceSet sourceSets.client
        }
    }
}

dependencies {
    // To change the versions see the gradle.properties file
    minecraft "com.mojang:minecraft:\${project.minecraft_version}"
${noRemap ? '' : '    mappings loom.officialMojangMappings()\n'}    ${impl} "net.fabricmc:fabric-loader:\${project.loader_version}"
    ${impl} "net.fabricmc.fabric-api:fabric-api:\${project.fabric_api_version}"
}

processResources {
    def version = project.version
    inputs.property "version", version

    filesMatching("fabric.mod.json") {
        expand "version": version
    }
}

tasks.withType(JavaCompile).configureEach {
    it.options.release = ${java}
}

java {
    withSourcesJar()
    sourceCompatibility = JavaVersion.VERSION_${java}
    targetCompatibility = JavaVersion.VERSION_${java}
}

jar {
    def projectName = project.name
    inputs.property "projectName", projectName
    from("LICENSE") {
        rename { "\${it}_\${projectName}" }
    }
}
`);

  files['src/main/resources/fabric.mod.json'] = JSON.stringify(
    {
      schemaVersion: 1,
      id: o.modId,
      version: '${version}',
      name: o.modName,
      description: o.description,
      authors: o.author ? [o.author] : [],
      contact: {},
      license: o.license,
      icon: `assets/${o.modId}/icon.png`,
      environment: '*',
      entrypoints: {
        main: [`${o.packageName}.${cls}`],
        client: [`${o.packageName}.client.${cls}Client`],
      },
      mixins: [`${o.modId}.mixins.json`, { config: `${o.modId}.client.mixins.json`, environment: 'client' }],
      depends: {
        fabricloader: `>=${FABRIC_LOADER_VERSION}`,
        minecraft: `~${o.mcVersion}`,
        java: `>=${java}`,
        'fabric-api': '*',
      },
    },
    null,
    '\t',
  ) + '\n';

  const mixinJson = (pkg: string, mixins: string[], client: boolean) =>
    JSON.stringify(
      {
        required: true,
        package: pkg,
        compatibilityLevel: `JAVA_${java}`,
        [client ? 'client' : 'mixins']: mixins,
        injectors: { defaultRequire: 1 },
        overwrites: { requireAnnotations: true },
      },
      null,
      '\t',
    ) + '\n';
  files[`src/main/resources/${o.modId}.mixins.json`] = mixinJson(`${o.packageName}.mixin`, ['ExampleMixin'], false);
  files[`src/client/resources/${o.modId}.client.mixins.json`] = mixinJson(`${o.packageName}.mixin.client`, [], true);

  const idc = idClass(o.mcVersion);
  files[`src/main/java/${pkgPath}/${cls}.java`] = tabs(`package ${o.packageName};

import net.fabricmc.api.ModInitializer;
import net.minecraft.resources.${idc};
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ${cls} implements ModInitializer {
    public static final String MOD_ID = "${o.modId}";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        // Runs as soon as Minecraft is in a mod-load-ready state.
${o.exampleItem ? '        ModItems.init();\n' : ''}        LOGGER.info("Hello from ${o.modName}!");
    }

    public static ${idc} id(String path) {
        return ${idc}.fromNamespaceAndPath(MOD_ID, path);
    }
}
`);

  files[`src/main/java/${pkgPath}/mixin/ExampleMixin.java`] = tabs(`package ${o.packageName}.mixin;

import net.minecraft.server.MinecraftServer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(MinecraftServer.class)
public class ExampleMixin {
    @Inject(at = @At("HEAD"), method = "loadLevel")
    private void ${o.modId}$onLoadLevel(CallbackInfo info) {
        // Injected at the start of MinecraftServer.loadLevel()
    }
}
`);

  files[`src/client/java/${pkgPath}/client/${cls}Client.java`] = tabs(`package ${o.packageName}.client;

import net.fabricmc.api.ClientModInitializer;

public class ${cls}Client implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        // Client-only setup (renderers, key mappings, screens...).
    }
}
`);

  if (o.exampleItem) {
    const tabApi = noRemap
      ? {
          imp: 'import net.fabricmc.fabric.api.creativetab.v1.CreativeModeTabEvents;',
          code: 'CreativeModeTabEvents.modifyOutputEvent(CreativeModeTabs.INGREDIENTS).register(output -> output.accept(RUBY));',
        }
      : {
          imp: 'import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;',
          code: 'ItemGroupEvents.modifyEntriesEvent(CreativeModeTabs.INGREDIENTS).register(entries -> entries.accept(RUBY));',
        };
    files[`src/main/java/${pkgPath}/ModItems.java`] = tabs(`package ${o.packageName};

import java.util.function.Function;
${tabApi.imp}
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.item.CreativeModeTabs;
import net.minecraft.world.item.Item;

public final class ModItems {
    public static final Item RUBY = register("ruby", Item::new, new Item.Properties());

    private static Item register(String name, Function<Item.Properties, Item> factory, Item.Properties properties) {
        ResourceKey<Item> key = ResourceKey.create(Registries.ITEM, ${cls}.id(name));
${f.itemPropertiesNeedId ? '        // Since 1.21.2 the properties must know the item id before the item is constructed.\n        Item item = factory.apply(properties.setId(key));' : '        Item item = factory.apply(properties);'}
        return Registry.register(BuiltInRegistries.ITEM, key, item);
    }

    public static void init() {
        ${tabApi.code}
    }

    private ModItems() {}
}
`);
  }
  return files;
}

// ---------------------------------------------------------------- NeoForge

function neoforgeProject(o: ModProjectOptions): Record<string, string | Uint8Array> {
  const f = getFeatures(o.mcVersion);
  const java = f.javaVersion;
  const neo = lookupVersion(NEOFORGE_VERSIONS, o.mcVersion);
  const parchment = f.unobfuscated ? undefined : lookupVersion(PARCHMENT_VERSIONS, o.mcVersion).value;
  const cls = className(o.modId);
  const pkgPath = o.packageName.replace(/\./g, '/');
  const files: Record<string, string | Uint8Array> = {};
  const legacyLoaderFields = !atLeast(o.mcVersion, '1.21.9');

  files['gradle.properties'] = `org.gradle.jvmargs=-Xmx1G
org.gradle.daemon=true
org.gradle.parallel=true
org.gradle.caching=true

# ---------------------------------------------------------------------------
# !!! CHECK THESE VERSIONS before building:
#   NeoForge:  https://projects.neoforged.net/neoforged/neoforge
#   Parchment: https://parchmentmc.org/docs/getting-started
# (generated by VSCodeCraft${neo.exact ? '' : ` — no known NeoForge version for ${o.mcVersion}, this one is a GUESS`})
# ---------------------------------------------------------------------------
minecraft_version=${o.mcVersion}
minecraft_version_range=[${o.mcVersion}]
neo_version=${neo.value ?? 'CHANGE_ME'}
${parchment ? `parchment_minecraft_version=${parchment[0]}\nparchment_mappings_version=${parchment[1]}\n` : ''}${legacyLoaderFields ? 'loader_version_range=[1,)\n' : ''}
# Mod Properties
mod_id=${o.modId}
mod_name=${o.modName}
mod_license=${o.license}
mod_version=1.0.0
mod_group_id=${o.packageName}
mod_authors=${o.author}
mod_description=${o.description.replace(/\n/g, ' ')}
`;

  files['settings.gradle'] = `pluginManagement {
    repositories {
        gradlePluginPortal()
    }
}

plugins {
    id 'org.gradle.toolchains.foojay-resolver-convention' version '1.0.0'
}

rootProject.name = '${o.modId}'
`;

  files['build.gradle'] = `plugins {
    id 'java-library'
    id 'maven-publish'
    // ModDevGradle — check the latest version: https://github.com/neoforged/ModDevGradle
    id 'net.neoforged.moddev' version '${MODDEV_PLUGIN_VERSION}'
    id 'idea'
}

version = mod_version
group = mod_group_id

sourceSets.main.resources {
    // Include resources generated by data generators.
    srcDir('src/generated/resources')
    exclude("**/*.bbmodel")
    exclude("src/generated/**/.cache")
}

base {
    archivesName = mod_id
}

java.toolchain.languageVersion = JavaLanguageVersion.of(${java})

neoForge {
    version = project.neo_version
${
  parchment
    ? `
    parchment {
        mappingsVersion = project.parchment_mappings_version
        minecraftVersion = project.parchment_minecraft_version
    }
`
    : ''
}
    runs {
        client {
            client()
            systemProperty 'neoforge.enabledGameTestNamespaces', project.mod_id
        }
        server {
            server()
            programArgument '--nogui'
            systemProperty 'neoforge.enabledGameTestNamespaces', project.mod_id
        }
        data {
            ${atLeast(o.mcVersion, '1.21.4') ? 'clientData()' : 'data()'}
            programArguments.addAll '--mod', project.mod_id, '--all', '--output', file('src/generated/resources/').getAbsolutePath(), '--existing', file('src/main/resources/').getAbsolutePath()
        }
        configureEach {
            systemProperty 'forge.logging.markers', 'REGISTRIES'
            logLevel = org.slf4j.event.Level.DEBUG
        }
    }

    mods {
        "\${mod_id}" {
            sourceSet(sourceSets.main)
        }
    }
}

configurations {
    runtimeClasspath.extendsFrom localRuntime
}

dependencies {
}

// Expands \${...} properties in src/main/templates (neoforge.mods.toml).
var generateModMetadata = tasks.register("generateModMetadata", ProcessResources) {
    var replaceProperties = [
            minecraft_version      : minecraft_version,
            minecraft_version_range: minecraft_version_range,
            neo_version            : neo_version,
${legacyLoaderFields ? '            loader_version_range   : loader_version_range,\n' : ''}            mod_id                 : mod_id,
            mod_name               : mod_name,
            mod_license            : mod_license,
            mod_version            : mod_version,
            mod_authors            : mod_authors,
            mod_description        : mod_description,
    ]
    inputs.properties replaceProperties
    expand replaceProperties
    from "src/main/templates"
    into "build/generated/sources/modMetadata"
}
sourceSets.main.resources.srcDir generateModMetadata
neoForge.ideSyncTask generateModMetadata

tasks.withType(JavaCompile).configureEach {
    options.encoding = 'UTF-8'
}

idea {
    module {
        downloadSources = true
        downloadJavadoc = true
    }
}
`;

  files['src/main/templates/META-INF/neoforge.mods.toml'] = `${legacyLoaderFields ? 'modLoader="javafml"\nloaderVersion="${loader_version_range}"\n' : ''}license="\${mod_license}"

[[mods]]
modId="\${mod_id}"
version="\${mod_version}"
displayName="\${mod_name}"
logoFile="assets/\${mod_id}/icon.png"
authors="\${mod_authors}"
description='''\${mod_description}'''

[[dependencies.\${mod_id}]]
    modId="neoforge"
    type="required"
    versionRange="[\${neo_version},)"
    ordering="NONE"
    side="BOTH"

[[dependencies.\${mod_id}]]
    modId="minecraft"
    type="required"
    versionRange="\${minecraft_version_range}"
    ordering="NONE"
    side="BOTH"
`;

  // registerSimpleItem(name) sets the item id on the properties for you (required since 1.21.2).
  const item = o.exampleItem ? `    public static final DeferredItem<Item> RUBY = ITEMS.registerSimpleItem("ruby");\n` : '';
  files[`src/main/java/${pkgPath}/${cls}.java`] = `package ${o.packageName};

import com.mojang.logging.LogUtils;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.CreativeModeTab;
import net.minecraft.world.item.CreativeModeTabs;
import net.minecraft.world.item.Item;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.event.lifecycle.FMLCommonSetupEvent;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;
import org.slf4j.Logger;

@Mod(${cls}.MODID)
public class ${cls} {
    public static final String MODID = "${o.modId}";
    public static final Logger LOGGER = LogUtils.getLogger();

    public static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(MODID);
    public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(MODID);
    public static final DeferredRegister<CreativeModeTab> CREATIVE_MODE_TABS = DeferredRegister.create(Registries.CREATIVE_MODE_TAB, MODID);

${item}
    public static final DeferredHolder<CreativeModeTab, CreativeModeTab> MAIN_TAB = CREATIVE_MODE_TABS.register("main", () -> CreativeModeTab.builder()
            .title(Component.translatable("itemGroup.${o.modId}"))
            .withTabsBefore(CreativeModeTabs.COMBAT)
            .icon(() -> ${o.exampleItem ? 'RUBY.get().getDefaultInstance()' : 'net.minecraft.world.item.Items.DIAMOND.getDefaultInstance()'})
            .displayItems((parameters, output) -> {
${o.exampleItem ? '                output.accept(RUBY.get());\n' : ''}            }).build());

    public ${cls}(IEventBus modEventBus, ModContainer modContainer) {
        modEventBus.addListener(this::commonSetup);
        BLOCKS.register(modEventBus);
        ITEMS.register(modEventBus);
        CREATIVE_MODE_TABS.register(modEventBus);
    }

    private void commonSetup(FMLCommonSetupEvent event) {
        LOGGER.info("Hello from ${o.modName}!");
    }
}
`;
  if (!o.exampleItem) {
    files[`src/main/java/${pkgPath}/${cls}.java`] = (files[`src/main/java/${pkgPath}/${cls}.java`] as string)
      .replace('import net.neoforged.neoforge.registries.DeferredItem;\n', '')
      .replace('import net.minecraft.world.item.Item;\n', '');
  }
  return files;
}
