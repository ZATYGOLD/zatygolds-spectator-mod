-- Zatygold's Spectator - setup parameters (setup database).

--*******************************************************
--***************** OBSERVER IN GAME ********************
--*******************************************************
-- Hidden. Set at setup while any player is the Spectator (single player, or the
-- multiplayer host); the modinfo loads the base-game overrides only when it is set.
INSERT INTO Parameters (ParameterID, Name, Description, Domain, Hash, DefaultValue, ConfigurationGroup, ConfigurationKey, GroupID, Hidden, ChangeableAfterGameStart, SortIndex)
    VALUES ('ZOMObserverInGame', 'LOC_ZOM_OBSERVER_IN_GAME', 'LOC_ZOM_OBSERVER_IN_GAME', 'bool', 0, 0, 'Game', 'ZOM_OBSERVER_IN_GAME', 'GameOptions', 1, 0, 9000);

--*******************************************************
--***************** SPECTATOR SLOT **********************
--*******************************************************
-- With Better Balanced Multiplayer only (its BBMSpectatorSlot is defined first):
-- whether its Match Types keep a lobby slot for the Spectator.
INSERT INTO Parameters (ParameterID, Name, Description, Domain, Hash, DefaultValue, ConfigurationGroup, ConfigurationKey, GroupID, SupportsSinglePlayer, ChangeableAfterGameStart, SortIndex)
SELECT 'ZOMSpectatorSlot', 'LOC_ZOM_SPECTATOR_SLOT_NAME', 'LOC_ZOM_SPECTATOR_SLOT_DESC', 'bool', 0, 1, 'Game', 'ZOMSpectatorSlot', 'LobbyOptions', 0, 0, 26
WHERE EXISTS (SELECT 1 FROM Parameters WHERE ParameterID = 'BBMSpectatorSlot');
