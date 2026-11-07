# VSCodeCraft — Minecraft Modding Toolkit

Extensión de VS Code todo-en-uno para crear **mods de Minecraft Java** (Fabric, Quilt, NeoForge, Forge), **datapacks** y **resource packs**, pensada para **Minecraft 1.21 – 1.21.11 y 26.1+** (26.1, 26.2, 26.3 y snapshots 26.4).

> *English summary below.*

## Qué incluye

### Detección automática del proyecto
- Detecta Fabric / Quilt / NeoForge / Forge / Paper / datapack / resource pack, el **id del mod** y la **versión de Minecraft** (desde `gradle.properties`, `fabric.mod.json`, `neoforge.mods.toml` o `pack.mcmeta`). Soporta proyectos multi-loader y la salida de datagen (`src/generated`, `src/main/generated`).
- Barra de estado con el loader y la **versión objetivo**; haz clic para cambiarla. Todas las herramientas escriben el formato correcto para esa versión (ingredientes `{"item":…}` vs `"…"`, definiciones de items 1.21.4+, `min_format`/`max_format` 1.21.9+, loot tables nuevas 26.3, recetas de pociones 26.3…).
- Datos vanilla: registros, tags y nombres de **1.21.1, 1.21.11 y 26.3 incluidos** (funciona sin conexión). Texturas, modelos, recetas y loot tables de cualquier versión se descargan bajo demanda del espejo comunitario [misode/mcmeta](https://github.com/misode/mcmeta) y se guardan en caché.

### Recetas
- **Vista previa y editor visual** con aspecto de GUI de Minecraft e iconos reales para todos los tipos: crafting (shaped, shapeless, transmute, dye, imbue, decorated pot, especiales), hornos, fogata, cortapiedras, herrería (transform/trim), **brewing (26.3)** y recetas de otros mods.
- Arrastra items desde la paleta, tags que van rotando, conteos, tiempos, XP.
- **Asistente "Nueva receta…"**, **Explorador de recetas** ("cómo se craftea X" / "usos de X", vanilla + tu mod, "Copiar a mi mod") y **migración de recetas** entre versiones.

### Modelos, bloques e items
- **Visor 3D** de modelos, blockstates (selector de propiedades) y definiciones de items, con vistas GUI/mano/suelo/marco, outlines y lista de elementos/texturas.
- **"Nuevo Item…" / "Nuevo Bloque…"**: crea modelo, textura de prueba, blockstate, definición de item, lang, loot table, tags de herramienta, receta y el **código Java de registro** (Fabric/NeoForge, según versión).
- **Generar set de bloques** (escaleras, losa, muro, valla, puerta, trampilla, botón, placa, panel…) idéntico al vanilla, y migración a definiciones de items 1.21.4+.

### Texturas
- **Editor pixel-art** de PNG integrado (lápiz, relleno, cuentagotas, selección, espejo, paletas, ajustes HSB, recoloreado, vista 3D, **animaciones** con `.mcmeta`).
- **Variantes de material** (p. ej. `diamond_*` → `sapphire_*`), copias de texturas vanilla, vista general del atlas y previsualización de texturas al pasar el ratón.

### IntelliSense para JSON
- **Esquemas** para recetas, loot tables, predicados, advancements, tags, encantamientos, modelos, blockstates, definiciones de items, `sounds.json`, fuentes, atlas, `pack.mcmeta`, `fabric.mod.json`… validados contra ~50 000 archivos vanilla reales.
- **Autocompletado de ids** (items, bloques, tags, modelos, texturas, sonidos, entidades…) con nombres, **hover**, **ir a definición** (también a archivos vanilla de solo lectura), **diagnósticos** ("¿quisiste decir…?", texturas/modelos que faltan, carpetas antiguas) con arreglos rápidos y selector de color.
- 68 snippets JSON (`mc-…`), snippets Java/Kotlin para Fabric y NeoForge (`fabric-…`, `neo-…`) y soporte `.mcfunction` (resaltado, snippets, autocompletado de comandos).

### Traducciones y texto
- **Editor de archivos lang** en tabla (todas las claves × todos los idiomas, iconos, % completado, claves que faltan, renombrar en todos los idiomas).
- "Añadir traducciones que faltan", "Buscar claves sin usar", **editor de text components** (JSON, SNBT, `/tellraw`, `/give`, códigos `§`) y vista previa de MOTD.

### Loot tables, advancements y /give
- **Visor/editor de loot tables** con probabilidades, conteos esperados y **simulador** de drops (fortuna, saqueo, toque de seda…).
- **Árbol de advancements** como en el juego, vista previa del toast y asistente "Nuevo advancement…".
- **Constructor de items / /give** con componentes de datos y salida para `/give`, `/summon`, loot tables y recetas, según la versión.

### Datapacks y resource packs
- Crear/actualizar `pack.mcmeta` para una versión o un rango (con overlays), **migración de recursos entre versiones**, **exportar a .zip** e **instalar en una instancia** (launcher oficial, Prism, MultiMC, CurseForge, Modrinth, ATLauncher, GDLauncher).
- **Editor de tags**, "Añadir a tag…", "Buscar usos del tag", y **Pack Doctor** (informe de problemas del pack).

### Barra lateral
- Vistas **Proyecto** (loader, versión, acciones rápidas), **Recursos** (todos tus archivos por namespace y tipo, con miniaturas; renombrar actualiza referencias) y **Vanilla** (navega items, bloques, recetas, loot tables, tags y registros de cualquier versión).
- Generadores de **datapack**, **resource pack** y **proyecto de mod** (Fabric/NeoForge).
- En Java, sobre cada registro de item/bloque: `assets: model ✓ texture ✓ lang ✓ recipe ✗` con acciones para crear lo que falta.

La interfaz está en **español e inglés** (sigue el idioma de VS Code).

## Ajustes principales

| Ajuste | Descripción |
| --- | --- |
| `vscodecraft.minecraftVersion` | Versión objetivo (`auto` = detectada). |
| `vscodecraft.defaultNamespace` | Namespace para recursos nuevos (vacío = id del mod). |
| `vscodecraft.data.allowDownload` / `autoDownload` | Descarga de datos vanilla. |
| `vscodecraft.language.diagnostics` | Diagnósticos de ids/texturas/modelos. |
| `vscodecraft.language.strictUnknownNamespaces` | Avisar también de ids de otros mods. |

Todos los comandos están en la paleta bajo **VSCodeCraft**.

## Desarrollo

```bash
npm install
npm run build        # manifiesto + bundles
npm test             # tests unitarios
npm run package      # genera el .vsix
```

Arquitectura y convenciones: [AGENTS.md](AGENTS.md). Las webviews se pueden probar fuera de VS Code con `node scripts/webview-harness.mjs <bundle>`.

## Notas

- Los datos y texturas vanilla **no se incluyen** en la extensión salvo listas de ids y nombres; las texturas se descargan bajo demanda del espejo comunitario de los archivos del juego. Minecraft es una marca de Mojang/Microsoft; este proyecto no está afiliado a ellos.
- Los fragmentos de código Java y los proyectos generados son puntos de partida: revisa las versiones de loader/API en `gradle.properties` antes de compilar.

---

## English summary

VSCodeCraft is an all-in-one VS Code toolkit for Minecraft Java mods (Fabric, Quilt, NeoForge, Forge), datapacks and resource packs targeting 1.21+ and 26.x. It auto-detects your project and target version, and offers: visual recipe preview/editor and recipe browser, 3D model/blockstate viewer, New Item/Block generators with Java registration snippets, a pixel-art texture editor with animations and material variants, JSON schemas + registry-aware completion/hover/go-to-definition/diagnostics, a lang editor and text component editor, loot table viewer with drop simulator, advancement tree, give/item builder, pack.mcmeta tools, version migration, zip export & instance install, tag editor, mcfunction support and a sidebar with project/resources/vanilla browsers. UI in English and Spanish.

License: MIT.
