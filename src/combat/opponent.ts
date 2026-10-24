import type { TransformNode } from "@babylonjs/core";
import type { QuestionRole, Spell } from "../data/spells";
import type { Witch } from "../entities/Witch";
import type { PracticeTarget } from "../entities/PracticeTarget";
import type { PracticeTargetKind } from "../world/spec/SectionSpec";
import { PRACTICE_TARGET_POWER } from "./combatBalance";

/** Как закончился бой с точки зрения игрока. */
export type BattleOutcome = "won" | "lost" | "retreated";

/** Тексты окна боя, которые зависят от того, с кем дерёмся. */
export interface OpponentMessages {
  /** Плашка окна, когда бьёт противник. */
  attackBadge: string;
  /** Игрок знает заклинания, но подходящих для этого боя нет. */
  noSpells: string;
  won: string;
  lost: string;
}

interface OpponentBase {
  readonly id: string;
  /** Как называем противника в окне боя. */
  readonly title: string;
  /** Узел сцены: сюда летят заклинания игрока и отсюда — противника; его же разворачиваем лицом к игроку. */
  readonly anchor: TransformNode;
  /** Максимум Силы противника. */
  readonly maxPower: number;
  /** Чем противник бьёт игрока (эта тема на него самого не действует); null — отвечать ударами не умеет. */
  readonly attackSpell: Spell | null;
  /** Из какого банка вопросов берутся атаки игрока. */
  readonly playerAttackRole: QuestionRole;
  /** Кто бьёт первым — решается в момент встречи. */
  readonly playerStrikesFirst: boolean;
  /** Реплика про инициативу для первого окна боя (null — без реплики). */
  readonly openingNote: string | null;
  readonly messages: OpponentMessages;
  /** Высота над anchor (м), куда целятся заклинания игрока и откуда бьёт противник. */
  readonly aimHeight: number;
  /** Развернуться лицом к точке. Не задано — сцена просто повернёт anchor. */
  faceToward?(x: number, z: number): void;
  /** Замах, когда противник бьёт (ведьма взмахивает посохом). */
  playCast?(): void;
}

export interface WitchOpponent extends OpponentBase {
  readonly kind: "witch";
  readonly witch: Witch;
}

export interface TargetOpponent extends OpponentBase {
  readonly kind: "target";
  readonly target: PracticeTarget;
}

/**
 * Всё, с чем можно сразиться: у любого противника есть шкала Силы (maxPower),
 * бой идёт, пока она или шкала игрока не опустеет. Новый вид противника — это
 * новый вариант объединения и фабричная функция ниже; менеджер боя не меняется.
 */
export type BattleOpponent = WitchOpponent | TargetOpponent;

const TARGET_TITLES: Record<PracticeTargetKind, string> = {
  tree: "Деревце",
  dummy: "Чучело",
  nettle: "Крапива",
};

/** Высота прицеливания: у ведьмы — грудь, у целей — «туловище» (крапива низкая). */
const WITCH_AIM_HEIGHT = 1.3;
const TARGET_AIM_HEIGHT: Record<PracticeTargetKind, number> = {
  tree: 1.4,
  dummy: 1.25,
  nettle: 0.3,
};

export interface OpponentFactory {
  witch(witch: Witch): BattleOpponent;
  target(target: PracticeTarget): BattleOpponent;
}

/**
 * Фабрика противников. `witchPower` — сила ведьмы в текущем месте мира (зависит от секции),
 * спрашивается в момент встречи.
 */
export function createOpponentFactory(witchPower: () => number): OpponentFactory {
  return {
    witch(witch) {
      // Первый удар: ведьма, которая в момент встречи видит игрока, бьёт первой.
      // Подкрался незамеченным (или идёт спарринг с дружелюбной) — первым бьёт игрок.
      const witchStrikesFirst = witch.hasSpottedPlayer;
      return {
        kind: "witch",
        witch,
        id: witch.id,
        title: `Ведьма ${witch.spell.law}`,
        anchor: witch.root,
        maxPower: witchPower(),
        attackSpell: witch.spell,
        playerAttackRole: "attackWitch",
        playerStrikesFirst: !witchStrikesFirst,
        aimHeight: WITCH_AIM_HEIGHT,
        faceToward: (x, z) => witch.faceToward(x, z),
        playCast: () => witch.swingStaff(),
        openingNote: witch.friendly
          ? null
          : witchStrikesFirst
            ? "Ведьма заметила тебя — она бьёт первой!"
            : "Ты подкрался незаметно — первый удар твой!",
        messages: {
          attackBadge: "Атака ведьмы",
          noSpells: `«${witch.spell.name}» на неё саму не действует, а боевых тем ты пока не знаешь. Отступи, выучи что-то ещё у костра и вернись.`,
          won: "Ведьма повержена — заклинание сработало как надо.",
          lost: "Сила на исходе. Подтянешь тему — вернёшься и попробуешь снова.",
        },
      };
    },

    target(target) {
      return {
        kind: "target",
        target,
        id: target.id,
        title: TARGET_TITLES[target.kind],
        anchor: target.root,
        maxPower: PRACTICE_TARGET_POWER,
        attackSpell: null, // цель не отвечает ударами: тренировка без риска
        playerAttackRole: "staticTarget",
        playerStrikesFirst: true,
        aimHeight: TARGET_AIM_HEIGHT[target.kind],
        openingNote: null,
        messages: {
          attackBadge: "Атака цели",
          noSpells: "Ты пока не знаешь ни одного заклинания — сначала загляни к костру.",
          won: "Цель разбита — можно тренироваться снова.",
          lost: "Сила на исходе. Передохни и возвращайся.",
        },
      };
    },
  };
}
