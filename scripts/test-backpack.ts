// Рюкзак: раскладка каскада (чистая функция), сам рюкзак на NullEngine,
// а также общие хелперы easing и цвета, на которых он стоит.
import { NullEngine, Scene, TransformNode, VertexBuffer, Vector3 } from "@babylonjs/core";
import { BOOK, Backpack, bookCascadeSlot, bookCoverColor, packSpaceFor } from "../src/entities/Backpack";
import { clamp01, easeInCubic, easeInOutCubic, easeOutBack, easeOutCubic, lerp } from "../src/core/easing";
import { hexToRgbTriplet, mixHex, shadeHex } from "../src/core/color";
import { ALL_BOOKS } from "../src/data/books";

declare const process: { exit(code?: number): never };

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

// --- easing ----------------------------------------------------------------------
for (const [name, fn] of [["easeOutCubic", easeOutCubic], ["easeInCubic", easeInCubic], ["easeInOutCubic", easeInOutCubic], ["easeOutBack", easeOutBack]] as const) {
  check(near(fn(0), 0) && near(fn(1), 1), `${name}: 0 → 0 и 1 → 1`);
  check(near(fn(-5), fn(0)) && near(fn(7), fn(1)), `${name}: вход зажимается в [0, 1]`);
}
check(easeOutCubic(0.5) > 0.5 && easeInCubic(0.5) < 0.5, "out быстрее линейной в начале, in — медленнее");
check(easeOutBack(0.8) > 1, "easeOutBack перелетает единицу (пружинит)");
check(clamp01(2) === 1 && clamp01(-1) === 0 && lerp(2, 4, 0.25) === 2.5, "clamp01 и lerp");

// --- цвет ------------------------------------------------------------------------
check(shadeHex("#ffffff", 0.5) === "#808080", "shadeHex темнит");
check(shadeHex("#808080", 2) === "#ffffff", "shadeHex обрезает до белого");
check(shadeHex("#f00", 1) === "#ff0000", "короткий hex #rgb поддержан");
check(mixHex("#000000", "#ffffff", 0.5) === "#808080" && mixHex("#102030", "#abcdef", 0) === "#102030", "mixHex: середина и края");
check(hexToRgbTriplet("#ff6b3d") === "255, 107, 61", "hexToRgbTriplet");
let threw = false;
try {
  shadeHex("not-a-color", 1);
} catch {
  threw = true;
}
check(threw, "некорректный цвет — ошибка, а не молчаливый чёрный");

// --- каскад ----------------------------------------------------------------------
const torso = { width: 0.7, height: 0.8, depth: 0.4 };
const space = packSpaceFor(torso);
check(space.width < torso.width && space.height < torso.height, "рюкзак не шире и не выше торса");

for (let n = 1; n <= 8; n++) {
  const slots = Array.from({ length: n }, (_, i) => bookCascadeSlot(i, n, space));
  const mean = (f: (s: (typeof slots)[number]) => number): number => slots.reduce((a, s) => a + f(s), 0) / n;
  check(near(mean((s) => s.x), 0, 1e-9) && near(mean((s) => s.y), space.centerY, 1e-9), `n=${n}: каскад отцентрован`);
  check(slots.every((s) => Object.values(s).every(Number.isFinite)), `n=${n}: нет NaN`);
  check(slots.every((s) => Math.abs(s.rotZ) < 0.25), `n=${n}: наклон небольшой`);
  // Глубина: книга целиком внутри рюкзака — между спиной и ремнями.
  const inside = slots.every((s) => s.z + BOOK.thickness / 2 <= 0 && s.z - BOOK.thickness / 2 >= -space.depth);
  check(inside, `n=${n}: все книги лежат между спиной и ремнями`);
  if (n >= 2) {
    check(slots.every((s, i) => i === 0 || (s.x > slots[i - 1].x && s.y < slots[i - 1].y && s.z < slots[i - 1].z)), `n=${n}: каждая следующая правее, ниже и ближе к камере`);
    const stepX = slots[1].x - slots[0].x;
    const stepY = slots[0].y - slots[1].y;
    check(stepX >= 0.03 && stepY >= 0.025, `n=${n}: видна полоска каждой книги (шаг ${stepX.toFixed(3)}×${stepY.toFixed(3)} м)`);
  }
  if (n <= 5) {
    const maxX = Math.max(...slots.map((s) => Math.abs(s.x))) + BOOK.width / 2;
    const maxTop = Math.max(...slots.map((s) => s.y)) + BOOK.height / 2;
    const minBottom = Math.min(...slots.map((s) => s.y)) - BOOK.height / 2;
    check(maxX <= space.width / 2 + 1e-9, `n=${n}: книги не вылезают за боковые ремни (${maxX.toFixed(3)} ≤ ${(space.width / 2).toFixed(3)})`);
    check(maxTop <= space.centerY + space.height / 2 + 0.03 && minBottom >= space.centerY - space.height / 2 - 0.03, `n=${n}: книги вписаны по высоте`);
  }
}
check(bookCascadeSlot(0, 1, space).x === 0, "одна книга — строго по центру");

// --- обложки ---------------------------------------------------------------------
const bookIds = ALL_BOOKS.map((b) => b.id);
check(bookIds.length >= 2, `в данных есть книги (${bookIds.length})`);
const covers = new Set(bookIds.map((id) => bookCoverColor(id).join(",")));
check(covers.size === bookIds.length, "у книг разных школ разные обложки");
check(bookCoverColor("book-unknown").every((c) => c >= 0 && c <= 1), "неизвестная книга получает нейтральную обложку, не падает");

// --- Backpack на сцене -------------------------------------------------------------
const engine = new NullEngine();
const scene = new Scene(engine);
const visual = new TransformNode("visual", scene);
const mountNode = new TransformNode("mount", scene);
mountNode.parent = visual;
mountNode.position.set(0, 1, -0.2);
const pack = new Backpack(scene, { node: mountNode, torso });

const frame = scene.getMeshByName("backpack_frame")!;
check(!!frame && frame.getTotalVertices() > 0 && frame.getTotalVertices() <= 24 * 24, `каркас — один меш (${frame?.getTotalVertices()} вершин)`);
check(Array.from(frame.getVerticesData(VertexBuffer.PositionKind)!).every(Number.isFinite), "каркас без NaN");
check(!!frame.getVerticesData(VertexBuffer.ColorKind), "каркас раскрашен вершинными цветами");
check(frame.getChildren().length === 0 && frame.parent?.name === "backpack", "каркас висит на корне рюкзака");
check(pack.bookCount === 0 && !pack.isAnimating, "новый рюкзак пуст и неподвижен");

pack.syncBooks(bookIds.slice(0, 1));
check(pack.bookCount === 1 && pack.hasBook(bookIds[0]), "syncBooks кладёт книгу");
const first = scene.getMeshByName(`backpack_book_${bookIds[0]}`)!;
check(!!first && first.scaling.x === 1 && !pack.isAnimating, "syncBooks без анимации: книга сразу на месте, масштаб 1");
check(first.material === frame.material, "книги и каркас на одном материале");
check(first.getTotalVertices() <= 24 * 12, `книга — один небольшой меш (${first.getTotalVertices()} вершин)`);

check(pack.addBook(bookIds[1]) === true && pack.bookCount === 2, "addBook добавляет новую книгу");
check(pack.addBook(bookIds[1]) === false && pack.bookCount === 2, "повторное добавление игнорируется");
check(pack.addBook("book-no-such") === false && pack.bookCount === 2, "неизвестная книга игнорируется");
const second = scene.getMeshByName(`backpack_book_${bookIds[1]}`)!;
check(pack.isAnimating && second.scaling.x < 1 && second.position.y > bookCascadeSlot(1, 2, space).y, "новая книга появляется сверху и увеличивается");
const firstStartX = first.position.x;
check(near(firstStartX, bookCascadeSlot(0, 1, space).x), "старая книга пока на прежнем месте");

for (let i = 0; i < 60 && pack.isAnimating; i++) pack.update(1 / 30);
check(!pack.isAnimating, "анимация заканчивается (рюкзак снова не требует обновлений)");
const s0 = bookCascadeSlot(0, 2, space);
const s1 = bookCascadeSlot(1, 2, space);
check(near(first.position.x, s0.x, 1e-3) && near(first.position.y, s0.y, 1e-3), "старая книга сдвинулась на новое место в каскаде");
check(near(second.position.x, s1.x, 1e-3) && near(second.position.y, s1.y, 1e-3) && near(second.scaling.x, 1, 1e-3), "новая книга легла на своё место");
check(near(first.rotation.z, s0.rotZ, 1e-3), "наклон веером выставлен");

// Прозрачность персонажа в кустах: setVisualAlpha идёт по getChildMeshes() визуала — рюкзак должен попадать в него.
const kids = visual.getChildMeshes();
check(kids.includes(frame) && kids.includes(first) && kids.includes(second), "рюкзак и книги — потомки визуала игрока (прозрачнеют вместе с ним)");
kids.forEach((m) => (m.visibility = 0.3));
check(frame.visibility === 0.3 && second.visibility === 0.3, "visibility обычных мешей рюкзака работает");

// Мировая точка центра — следует за поворотом персонажа.
visual.position.set(10, 0, 5);
visual.rotation.y = 0;
const c0 = pack.worldCenter();
visual.rotation.y = Math.PI;
const c1 = pack.worldCenter();
check(near(c0.x, 10, 1e-6) && c0.z < 5 - 0.1, "центр рюкзака позади персонажа (−z при взгляде в +z)");
check(near(c1.x, 10, 1e-6) && c1.z > 5 + 0.1, "после разворота на 180° рюкзак по другую сторону");
check(near(Vector3.Distance(c0, new Vector3(10, 1, 5)), Vector3.Distance(c1, new Vector3(10, 1, 5)), 1e-6), "расстояние до торса при развороте не меняется");

// Синхронизация состоянием.
pack.syncBooks([]);
check(pack.bookCount === 0 && !scene.getMeshByName(`backpack_book_${bookIds[0]}`), "syncBooks([]) убирает книги и их меши");
pack.syncBooks(bookIds, true);
check(pack.bookCount === bookIds.length, "syncBooks добавляет все недостающие");

pack.dispose();
check(!scene.getMeshByName("backpack_frame") && !scene.getTransformNodeByName("backpack"), "dispose убирает каркас, книги и корень");
check(!mountNode.isDisposed(), "узел крепления принадлежит игроку и остаётся");

scene.dispose();
if (failures > 0) {
  console.error(`\n${failures} из ${checks} проверок не прошли`);
  process.exit(1);
}
console.log(`OK: рюкзак прошёл ${checks} проверок`);
