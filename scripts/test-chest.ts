// Сундук как сущность на сцене Babylon (NullEngine): открытие, содержимое,
// переживание пересборки секции и интеграция со стримингом мира.
import { NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { Chest } from "../src/entities/Chest";
import { GameState } from "../src/core/GameState";
import { bookIdOfSchool, pageIdOfSpell } from "../src/data/books";
import { getSpellById } from "../src/data/spells";
import { generateWorld } from "../src/world/WorldGenerator";
import { WorldStreamer } from "../src/world/WorldStreamer";

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

const engine = new NullEngine();
const scene = new Scene(engine);

// --- 1. Динамический сундук: содержимое подбирается при открытии. ---
{
  const gs = new GameState();
  const chest = new Chest(scene, new Vector3(0, 0, 0), { id: "dyn-1", bookIds: [], pageIds: [], dynamicSlots: 2 }, gs);
  check(!chest.isOpened, "новый сундук закрыт");
  const before = chest.getContents();
  check(before.books.length === 0 && before.pages.length === 0, "закрытый динамический сундук ещё пуст (не определён)");

  const contents = chest.open();
  check(chest.isOpened && gs.isChestOpen("dyn-1"), "сундук открыт и записан в GameState");
  check(contents.books.length === 1 && contents.pages.length === 1, "первый сундук: книга и страница");
  check(contents.books[0].id === bookIdOfSchool("earth"), "книга — Школа земли");
  check(contents.pages[0].id === pageIdOfSpell("velocity"), "страница — velocity");
  check(gs.hasBook(bookIdOfSchool("earth")) && gs.hasBookPage(pageIdOfSpell("velocity")), "находки в коллекции игрока");

  const again = chest.open();
  check(again.books.length === 1 && again.pages.length === 1, "повторное открытие возвращает то же содержимое");
  check(gs.getCollectedBookPageIds().length === 1, "повторное открытие ничего не добавляет");

  // Пересборка секции: новый Chest с тем же id (как после выгрузки чанка).
  chest.dispose();
  const rebuilt = new Chest(scene, new Vector3(0, 0, 0), { id: "dyn-1", bookIds: [], pageIds: [], dynamicSlots: 2 }, gs);
  check(rebuilt.isOpened, "пересобранный сундук остаётся открытым");
  const rc = rebuilt.getContents();
  check(rc.books.length === 1 && rc.pages.length === 1 && rc.pages[0].id === pageIdOfSpell("velocity"), "пересобранный сундук помнит, что в нём было");

  // Следующий сундук не повторяет найденное.
  const next = new Chest(scene, new Vector3(5, 0, 0), { id: "dyn-2", bookIds: [], pageIds: [], dynamicSlots: 2 }, gs);
  const nc = next.open();
  const ids = [...nc.books.map((b) => b.id), ...nc.pages.map((p) => p.id)];
  check(ids.length === 2, "второй сундук: два предмета");
  check(!ids.includes(bookIdOfSchool("earth")) && !ids.includes(pageIdOfSpell("velocity")), "второй сундук не дублирует найденное");
}

// --- 2. Рукописный сундук отдаёт ровно то, что в нём указано. ---
{
  const gs = new GameState();
  const chest = new Chest(
    scene,
    new Vector3(0, 0, 0),
    { id: "intro", bookIds: [bookIdOfSchool("fire")], pageIds: [pageIdOfSpell("spark")] },
    gs
  );
  const c = chest.open();
  check(c.books.map((b) => b.id).join() === bookIdOfSchool("fire"), "рукописный сундук: указанная книга");
  check(c.pages.map((p) => p.id).join() === pageIdOfSpell("spark"), "рукописный сундук: указанная страница");
  check(gs.canLearn(getSpellById("spark")), "после рукописного сундука spark можно изучить");
}

// --- 3. Интеграция со стримером: сундуки мира получают динамические слоты. ---
{
  const gs = new GameState();
  const world = generateWorld(gs, 7);
  const streamer = new WorldStreamer(scene, world, gs);
  streamer.update(world.spawnPoint.x, world.spawnPoint.z);

  const chests = streamer.getActiveChests();
  check(chests.length > 0, "в окне стриминга есть сундуки");
  const intro = chests.find((c) => c.id === "chest-intro-0");
  check(!!intro, "вводный сундук первой секции построен");

  // Открываем вводный сундук, пересобираем мир (уходим и возвращаемся) — он остаётся открытым.
  intro!.open();
  check(gs.hasBook(bookIdOfSchool("earth")), "вводный сундук выдал книгу Школы земли");
  check(gs.hasBookPage(pageIdOfSpell("velocity")) && gs.hasBookPage(pageIdOfSpell("density")), "вводный сундук выдал две страницы");

  const last = world.sections[world.sections.length - 1];
  const far = { x: last.end.x, z: last.end.z };
  streamer.update(far.x, far.z);
  streamer.update(world.spawnPoint.x, world.spawnPoint.z);
  const intro2 = streamer.getActiveChests().find((c) => c.id === "chest-intro-0");
  check(!!intro2 && intro2.isOpened, "после выгрузки и пересборки секции вводный сундук всё ещё открыт");
}

if (failures === 0) {
  console.log(`Проверок: ${checks}, провалов: 0`);
  console.log("OK: сундук — открытие, содержимое, пересборка секции, стриминг");
} else {
  console.error(`Проверок: ${checks}, провалов: ${failures}`);
  console.error("FAILED: сундук");
  process.exit(1);
}
