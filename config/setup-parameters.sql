-- Zatygold's Spectator - hidden setup parameter (setup database).

--*******************************************************
--***************** OBSERVER IN GAME ********************
--*******************************************************
-- Hidden. Set at setup while any player is the Spectator (single player, or the
-- multiplayer host); the modinfo loads the base-game overrides only when it is set.
INSERT INTO Parameters (ParameterID, Name, Description, Domain, Hash, DefaultValue, ConfigurationGroup, ConfigurationKey, GroupID, Hidden, ChangeableAfterGameStart, SortIndex)
    VALUES ('ZOMObserverInGame', 'LOC_ZOM_OBSERVER_IN_GAME', 'LOC_ZOM_OBSERVER_IN_GAME', 'bool', 0, 0, 'Game', 'ZOM_OBSERVER_IN_GAME', 'GameOptions', 1, 0, 9000);
