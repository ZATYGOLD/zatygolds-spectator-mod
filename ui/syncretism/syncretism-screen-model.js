import { createMemo, createSignal, createContext, useContext } from '../../../core/vendor/solid-js/dist/solid.js';
import { createMutable } from '../../../core/vendor/solid-js/store/dist/store.js';
import { ContextManager } from '../../../core/ui/context-manager/context-manager.js';
import { DatabaseCache } from '../../../core/ui/utilities/utilities-data.js';
import { Icon } from '../../../core/ui/utilities/utilities-image.js';
import { Layout } from '../../../core/ui/utilities/utilities-layout.js';
import { ModelRegistry, ModelLifecycle } from '../../../core/ui-next/services/model-registry.js';
import { LayoutModel } from '../../../core/ui-next/utilities/layout-utilities.js';
import PopupSequencer from '../popup-sequencer/popup-sequencer.js';

/*
 * Zatygold's Spectator - base-game override.
 * Copied verbatim from the game's base-standard/ui/syncretism/syncretism-screen-model.js
 * (build dated 2026-09-16). The only changes are marked "ZOM:", plus every
 * GameContext.localPlayerID read as zomLocalPlayerID(): for the Observer the
 * leader picked in the screen's leader row. Game actions keep the real local
 * player.
 * Re-apply after game updates; see ui/observer/observer-leader-view.js.
 */
const zomLocalPlayerID = () => globalThis.ZOMLeaderView?.playerID() ?? GameContext.localPlayerID;   // ZOM: viewed leader, else the local player

const attributeFilters = [
  "ALL ATTRIBUTES",
  "ECONOMIC",
  "SCIENTIFIC",
  "MILITARISTIC",
  "EXPANSIONIST",
  "DIPLOMATIC"
];
function getOpFlagString(flag) {
  if (flag == SyncreticChoiceTypes.SYNCRETIC_CHOICE_UNITS) {
    return "LOC_UI_SYNCRETISM_UNITS";
  } else if (flag == SyncreticChoiceTypes.SYNCRETIC_CHOICE_INFRASTRUCTURE) {
    return "LOC_UI_SYNCRETISM_INFRASTRUCTURE";
  } else if (flag == SyncreticChoiceTypes.SYNCRETIC_CHOICE_SELF) {
    return "LOC_UI_SYNCRETISM_SELF";
  }
  return "";
}
function getChoiceTypeShort(flagType) {
  if (flagType == SyncreticChoiceTypes.SYNCRETIC_CHOICE_UNITS) {
    return "units";
  } else if (flagType == SyncreticChoiceTypes.SYNCRETIC_CHOICE_INFRASTRUCTURE) {
    return "infrastructure";
  } else if (flagType == SyncreticChoiceTypes.SYNCRETIC_CHOICE_SELF) {
    return "self";
  }
  return "";
}
const SMALL_SCREEN_MODE_MAX_HEIGHT = 800;
const SMALL_SCREEN_MODE_MAX_WIDTH = 1e3;
const layout = LayoutModel.get();
const isSmallScreenSize = createMemo(() => {
  const isMobileViewExperience = UI.getViewExperience() == UIViewExperience.Mobile;
  return isMobileViewExperience || layout.screenHeight() <= Layout.pixelsToScreenPixels(SMALL_SCREEN_MODE_MAX_HEIGHT) || layout.screenWidth() <= Layout.pixelsToScreenPixels(SMALL_SCREEN_MODE_MAX_WIDTH);
});
const cachedCivDatabase = new DatabaseCache("config");
function createSyncretismScreenModel() {
  const [activeSyncretismTab, setActiveSyncretismTab] = createSignal("screen-syncretism");
  function populateInfrastructure() {
    const player = Players.get(zomLocalPlayerID());
    if (!player) {
      console.error("Syncretism query returns no infrastructure because player not found");
      return [];
    }
    const syncCivs = Game.Unlocks.getSyncreticCivUnlocksForChoice(
      player.id,
      SyncreticChoiceTypes.SYNCRETIC_CHOICE_INFRASTRUCTURE
    );
    const cardSet = [];
    if (syncCivs) {
      for (let i = 0; i < syncCivs?.length; i++) {
        const civType = GameInfo.LegacyCivilizationTraits.lookup(syncCivs[i]);
        const civName = GameInfo.Civilizations.lookup(civType?.CivilizationType ?? "");
        const civIcon = Icon.getCivSymbolCSSFromCivilizationType(civType?.CivilizationType ?? "");
        const civBgImage = `bg-panel-${civName?.CivilizationType.replace("CIVILIZATION_", "").toLowerCase()}`;
        const args = { CivilizationType: syncCivs[i] };
        const result = Game.PlayerOperations.canStart(
          GameContext.localPlayerID,
          PlayerOperationTypes.CHOOSE_SYNCRETISM_INFRASTRUCTURE,
          args,
          false
        );
        const civTagData = cachedCivDatabase.query(
          "select * from CivilizationTags inner join Tags on CivilizationTags.TagType = Tags.TagType inner join TagCategories on Tags.TagCategoryType = TagCategories.TagCategoryType"
        );
        const traitsLoc = civTagData.filter(
          (tag) => !tag.HideInDetails && tag.TagCategoryType == "TAG_CATEGORY_TRAIT" && tag.CivilizationType == civType?.CivilizationType
        ).map((t) => t.Name);
        const traits = traitsLoc.map((item) => item);
        const cardSyncretized = testCardSyncretized(
          civName?.Name ?? "",
          SyncreticChoiceTypes.SYNCRETIC_CHOICE_INFRASTRUCTURE
        );
        const choiceMade = syncreticChoiceMade();
        const card = {
          civ: civName?.Name ?? "",
          civIcon,
          itemsAvailable: [],
          civDef: syncCivs[i],
          flagType: SyncreticChoiceTypes.SYNCRETIC_CHOICE_INFRASTRUCTURE,
          traits,
          bgImage: civBgImage,
          isSyncretized: cardSyncretized,
          hasSyncreticChoiceBeenMade: choiceMade
        };
        const upgradableConstructibles = Game.Unlocks.getInfrastructureChoiceSyncreticUnlocks(
          civType?.CivilizationType ?? ""
        );
        const uniqueQuarters = [];
        const buildings = [];
        const improvements = [];
        const units = [];
        upgradableConstructibles?.forEach((q) => {
          if (q.kind == "KIND_QUARTER") {
            const unlockQuarter = GameInfo.UniqueQuarters.lookup(q.typeHash);
            if (unlockQuarter) uniqueQuarters.push(unlockQuarter);
          } else if (q.kind == "KIND_CONSTRUCTIBLE") {
            const buildingDef = GameInfo.Constructibles.lookup(q.typeHash);
            if (buildingDef?.ConstructibleClass == "BUILDING") buildings.push(buildingDef);
            if (buildingDef?.ConstructibleClass == "IMPROVEMENT") improvements.push(buildingDef);
          } else if (q.kind == "KIND_UNIT") {
            const unlockUnit = GameInfo.Units.lookup(q.typeHash);
            if (unlockUnit) units.push(unlockUnit);
          }
        });
        for (const uniqueQuarter of uniqueQuarters) {
          let uniqueQuarterCss = "url(blp:fi_city_uniquequarter_256)";
          if (UI.getIconCSS(uniqueQuarter.UniqueQuarterType) != "") {
            uniqueQuarterCss = UI.getIconCSS(uniqueQuarter.UniqueQuarterType);
          }
          const newSyncItem = {
            name: Locale.stylize(uniqueQuarter.Name),
            icon: uniqueQuarterCss,
            description: Locale.stylize(uniqueQuarter?.Description ?? "")
          };
          card.itemsAvailable.push(newSyncItem);
        }
        for (const building of buildings) {
          if (building) {
            const newSyncItem = {
              name: Locale.stylize(building.Name),
              icon: UI.getIconCSS(building.ConstructibleType),
              description: Locale.stylize(building?.Description ?? "")
            };
            card.itemsAvailable.push(newSyncItem);
          }
        }
        for (const improvement of improvements) {
          if (improvement) {
            const newSyncItem = {
              name: Locale.stylize(improvement.Name),
              icon: UI.getIconCSS(improvement.ConstructibleType),
              description: Locale.stylize(improvement?.Description ?? "")
            };
            card.itemsAvailable.push(newSyncItem);
          }
        }
        for (const unit of units) {
          if (unit) {
            const addInfo = getAdditionalDescriptions(result, unit.$hash) ?? "";
            let addInfo1 = "";
            let addInfo2 = "";
            let unlocked = false;
            if (unit && player.Units) {
              unlocked = player.Units.isReplacedUnitUnlocked(unit.UnitType, true, false);
            }
            if (!unlocked) {
              addInfo2 = addInfo[0] ?? "";
            } else {
              addInfo1 = addInfo[0] ?? "";
            }
            const query = "SELECT Description from CivilizationItems where Type=?";
            const baseDescription = Database.query("config", query, unit.UnitType)?.[0]?.Description;
            if (baseDescription) {
              const newSyncItem = {
                name: unit.Name,
                description: baseDescription,
                icon: UI.getIconCSS(unit.UnitType, "UNIT_FLAG"),
                addInfo1,
                addInfo2
              };
              card.itemsAvailable.push(newSyncItem);
            }
          }
        }
        cardSet.push(card);
      }
    }
    return cardSet;
  }
  function populateUnits() {
    const player = Players.get(zomLocalPlayerID());
    if (!player) {
      console.error("Syncretism query returns no units because player not found");
      return [];
    }
    const syncCivs = Game.Unlocks.getSyncreticCivUnlocksForChoice(
      player.id,
      SyncreticChoiceTypes.SYNCRETIC_CHOICE_UNITS
    );
    const cardSet = [];
    if (syncCivs) {
      for (let i = 0; i < syncCivs?.length; i++) {
        const civType = GameInfo.LegacyCivilizationTraits.lookup(syncCivs[i]);
        const civName = GameInfo.Civilizations.lookup(civType?.CivilizationType ?? "");
        const civIcon = Icon.getCivSymbolCSSFromCivilizationType(civType?.CivilizationType ?? "");
        const civBgImage = `bg-panel-${civName?.CivilizationType.replace("CIVILIZATION_", "").toLowerCase()}`;
        const args = { CivilizationType: syncCivs[i] };
        const result = Game.PlayerOperations.canStart(
          GameContext.localPlayerID,
          PlayerOperationTypes.CHOOSE_SYNCRETISM_UNITS,
          args,
          false
        );
        const civTagData = cachedCivDatabase.query(
          "select * from CivilizationTags inner join Tags on CivilizationTags.TagType = Tags.TagType inner join TagCategories on Tags.TagCategoryType = TagCategories.TagCategoryType"
        );
        const traitsLoc = civTagData.filter(
          (tag) => !tag.HideInDetails && tag.TagCategoryType == "TAG_CATEGORY_TRAIT" && tag.CivilizationType == civType?.CivilizationType
        ).map((t) => t.Name);
        const traits = traitsLoc.map((item) => item);
        const cardSyncretized = testCardSyncretized(
          civName?.Name ?? "",
          SyncreticChoiceTypes.SYNCRETIC_CHOICE_UNITS
        );
        const choiceMade = syncreticChoiceMade();
        const card = {
          civ: civName?.Name ?? "",
          civIcon,
          itemsAvailable: [],
          civDef: syncCivs[i],
          flagType: SyncreticChoiceTypes.SYNCRETIC_CHOICE_UNITS,
          traits,
          bgImage: civBgImage,
          isSyncretized: cardSyncretized,
          hasSyncreticChoiceBeenMade: choiceMade
        };
        const upgradableUnits = Game.Unlocks.getUnitChoiceSyncreticUnlocks(civType?.CivilizationType ?? "");
        if (upgradableUnits)
          for (const unlock of upgradableUnits) {
            if (unlock.kind == "KIND_UNIT") {
              const unitDef = GameInfo.Units.lookup(unlock.typeHash);
              const addInfo = getAdditionalDescriptions(result, unlock.typeHash) ?? "";
              let addInfo1 = "";
              let addInfo2 = "";
              let unlocked = false;
              if (unitDef && player.Units) {
                unlocked = player.Units.isReplacedUnitUnlocked(unitDef.UnitType, true, false);
              }
              for (let i2 = 0; i2 < addInfo.length; i2++) {
                if (!unlocked) {
                  addInfo2 = addInfo[i2];
                  continue;
                }
                addInfo1 = addInfo1 + " " + addInfo[i2];
              }
              if (unitDef) {
                const query = "SELECT Description from CivilizationItems where Type=?";
                const baseDescription = Database.query("config", query, unitDef.UnitType)?.[0]?.Description;
                if (baseDescription) {
                  const newSyncItem = {
                    name: unitDef.Name,
                    description: baseDescription,
                    icon: UI.getIconCSS(unitDef.UnitType, "UNIT_FLAG"),
                    addInfo1,
                    addInfo2
                  };
                  card.itemsAvailable.push(newSyncItem);
                }
              }
            }
          }
        cardSet.push(card);
      }
    }
    return cardSet;
  }
  function populateSelf() {
    const player = Players.get(zomLocalPlayerID());
    if (!player) {
      console.error("Syncretism query returns nothing because player not found");
      return [];
    }
    const syncCivs = Game.Unlocks.getSyncreticCivUnlocksForChoice(
      player.id,
      SyncreticChoiceTypes.SYNCRETIC_CHOICE_SELF
    );
    const cardSet = [];
    if (syncCivs) {
      for (let i = 0; i < syncCivs?.length; i++) {
        const civType = GameInfo.LegacyCivilizationTraits.lookup(syncCivs[i]);
        const civName = GameInfo.Civilizations.lookup(civType?.CivilizationType ?? "");
        const civIcon = Icon.getCivSymbolCSSFromCivilizationType(civType?.CivilizationType ?? "");
        const civBgImage = `bg-panel-${civName?.CivilizationType.replace("CIVILIZATION_", "").toLowerCase()}`;
        const civTagData = cachedCivDatabase.query(
          "select * from CivilizationTags inner join Tags on CivilizationTags.TagType = Tags.TagType inner join TagCategories on Tags.TagCategoryType = TagCategories.TagCategoryType"
        );
        const traitsLoc = civTagData.filter(
          (tag) => !tag.HideInDetails && tag.TagCategoryType == "TAG_CATEGORY_TRAIT" && tag.CivilizationType == civType?.CivilizationType
        ).map((t) => t.Name);
        const traits = traitsLoc.map((item) => item);
        const cardSyncretized = testCardSyncretized(
          civName?.Name ?? "",
          SyncreticChoiceTypes.SYNCRETIC_CHOICE_SELF
        );
        const choiceMade = syncreticChoiceMade();
        const card = {
          civ: civName?.Name ?? "",
          civIcon,
          itemsAvailable: [],
          civDef: syncCivs[i],
          flagType: SyncreticChoiceTypes.SYNCRETIC_CHOICE_SELF,
          traits,
          bgImage: civBgImage,
          isSyncretized: cardSyncretized,
          hasSyncreticChoiceBeenMade: choiceMade
        };
        const unlockables = Game.Unlocks.getSelfChoiceSyncreticUnlocks(civType?.CivilizationType ?? "");
        if (unlockables)
          for (const unlock of unlockables) {
            if (unlock.kind == "KIND_TRADITION") {
              const unlockTradition = GameInfo.Traditions.lookup(unlock.typeHash);
              if (unlockTradition) {
                const newSyncItem = {
                  name: Locale.stylize(unlockTradition.Name),
                  description: Locale.stylize(unlockTradition?.Description ?? ""),
                  icon: "url(blp:icon_tradition)"
                };
                card.itemsAvailable.push(newSyncItem);
              }
            }
            if (unlock.kind == "KIND_CULTURE_SLOT") {
              const unlockSlot = GameInfo.CultureSlots.lookup(unlock.typeHash);
              if (unlockSlot) {
                const newSyncItem = {
                  name: Locale.stylize(unlockSlot.Name),
                  icon: "url(blp:ntf_tradition_slot_upgrade)"
                };
                card.itemsAvailable.push(newSyncItem);
              }
            }
          }
        cardSet.push(card);
      }
    }
    return cardSet;
  }
  function getAdditionalDescriptions(result, typeHash) {
    const ret = [];
    if (result.AdditionalDescription) {
      const index = result.Units?.findIndex((value) => {
        return value == typeHash;
      }) ?? -1;
      if (index >= 0 && result.AdditionalDescription.length > index) {
        ret.push(result.AdditionalDescription[index]);
      }
    }
    return ret;
  }
  function populateSyncretismCards() {
    const unitSet = populateUnits();
    const infrstructureSet = populateInfrastructure();
    const selfSet = populateSelf();
    const wholeSet = combineAlternating(unitSet, infrstructureSet);
    for (let i = 0; i < selfSet.length; i++) {
      wholeSet.unshift(selfSet[i]);
    }
    return wholeSet;
  }
  function combineAlternating(arr1, arr2) {
    const result = [];
    const maxLength = Math.max(arr1.length, arr2.length);
    for (let i = 0; i < maxLength; i++) {
      if (i < arr1.length) {
        result.push(arr1[i]);
      }
      if (i < arr2.length) {
        result.push(arr2[i]);
      }
    }
    return result;
  }
  const starterCards = [
    {
      civ: "default",
      civIcon: "",
      itemsAvailable: [],
      civDef: getPlaceHolderCiv(),
      flagType: SyncreticChoiceTypes.SYNCRETIC_CHOICE_INFRASTRUCTURE,
      traits: [],
      bgImage: "",
      isSyncretized: false,
      hasSyncreticChoiceBeenMade: false
    }
  ];
  function getPlaceHolderCiv() {
    const player = Players.get(zomLocalPlayerID());
    return player.civilizationType;
  }
  function getSyncretizedInfo() {
    const player = Players.get(zomLocalPlayerID());
    const chosenCard = {
      civ: "",
      flagType: SyncreticChoiceTypes.SYNCRETIC_CHOICE_SELF
    };
    if (!player) return chosenCard;
    if (!player.Identity) return chosenCard;
    chosenCard.civ = GameInfo.Civilizations.lookup(player.Identity.getSyncreticCivType())?.Name?.toString() ?? "";
    chosenCard.flagType = player.Identity.getSyncreticChoiceType();
    return chosenCard;
  }
  function syncretizeSelection(civ, flag) {
    let opType = PlayerOperationTypes.CHOOSE_SYNCRETISM_UNITS;
    if (flag === SyncreticChoiceTypes.SYNCRETIC_CHOICE_INFRASTRUCTURE) {
      opType = PlayerOperationTypes.CHOOSE_SYNCRETISM_INFRASTRUCTURE;
    } else if (flag === SyncreticChoiceTypes.SYNCRETIC_CHOICE_SELF) {
      opType = PlayerOperationTypes.CHOOSE_SYNCRETISM_SELF;
    }
    const args = { CivilizationType: civ };
    const result = Game.PlayerOperations.canStart(GameContext.localPlayerID, opType, args, false);
    if (result.Success) {
      Game.PlayerOperations.sendRequest(GameContext.localPlayerID, opType, args);
    }
  }
  function handleCardClick(card) {
    model.selectedCiv = card;
    if (card.bgImage) {
      model.selectedCivBg = card.bgImage;
    }
    setActiveSyncretismTab("syncretism-confirm");
  }
  function handleCivSelect(civ, flag) {
    syncretizeSelection(civ, flag);
    ContextManager.pop("screen-syncretism");
  }
  function syncreticChoiceMade() {
    return getSyncretizedInfo().civ != "";
  }
  function testCardSyncretized(civ, flag) {
    if (getSyncretizedInfo().civ == civ && getSyncretizedInfo().flagType == flag) {
      return true;
    }
    return false;
  }
  function handleClickClose() {
    ContextManager.pop("screen-syncretism");
  }
  function handleClickCloseInfo() {
    PopupSequencer.closePopup("syncretism-info-card");
  }
  const model = createMutable({
    title: "Syncretism",
    data: populateSyncretismCards(),
    selectedCivBg: "",
    selectedCiv: starterCards[0],
    syncretismChoiceMade: syncreticChoiceMade(),
    isFirstSeen: false,
    clickCloseButton: handleClickClose,
    clickCloseInfoButton: handleClickCloseInfo,
    onCardClick: handleCardClick,
    onFinalizeChoice: handleCivSelect,
    isSmallScreen: isSmallScreenSize,
    activeTab: activeSyncretismTab,
    setActiveTab: setActiveSyncretismTab
  });
  return model;
}
function getAge() {
  const currentAge = GameInfo.Ages.lookup(Game.age);
  return currentAge ? currentAge.Name : "";
}
function getCivNameString() {
  const player = Players.get(zomLocalPlayerID());
  if (!player) {
    return "";
  }
  const civTypeName = player.civilizationFullName;
  if (!civTypeName) {
    return "";
  }
  return civTypeName;
}
function getTraitIcon(trait) {
  if (!trait) {
    return "";
  }
  switch (trait) {
    case "LOC_TAG_TRAIT_CULTURAL_NAME":
      return "ntf_advisor_cultural_blk";
    case "LOC_TAG_TRAIT_POLITICAL_NAME":
      return "ntf_diplomatic_action_blk";
    case "LOC_TAG_TRAIT_ECONOMIC_NAME":
      return "ntf_advisor_economic_blk";
    case "LOC_TAG_TRAIT_EXPANSIONIST_NAME":
      return "ntf_advisor_expansionist_blk";
    case "LOC_TAG_TRAIT_MILITARISTIC_NAME":
      return "ntf_advisor_militaristic_blk";
    case "LOC_TAG_TRAIT_SCIENTIFIC_NAME":
      return "ntf_advisor_scientific_blk";
    case "LOC_TAG_TRAIT_ALL_NAME":
      return "mpicon_kick";
  }
  return "unitflag_missingicon";
}
const SyncretismScreenModel = ModelRegistry.register(
  "SyncretismScreenModel",
  ModelLifecycle.SharedInstance,
  createSyncretismScreenModel
);
const SyncretismScreenModelContext = createContext();
function useSyncretismModelContext() {
  const context = useContext(SyncretismScreenModelContext);
  if (!context) {
    throw new Error("useSyncretismModelContext: Cannot find context!");
  }
  return context;
}

export { SyncretismScreenModel, SyncretismScreenModelContext, attributeFilters, createSyncretismScreenModel, getAge, getChoiceTypeShort, getCivNameString, getOpFlagString, getTraitIcon, useSyncretismModelContext };
//# sourceMappingURL=syncretism-screen-model.js.map
