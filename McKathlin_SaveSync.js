//=============================================================================
// Save Sync
// by McKathlin
// McKathlin_SaveFinder.js
//=============================================================================

/*
 * MIT License
 *
 * Copyright (c) 2024 Kathy Bunn and Scott Tyrus Washburn
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

var Imported = Imported || {};
Imported.McKathlin_SaveSync = true;

var McKathlin = McKathlin || {};
McKathlin.SaveSync = {};

/*:
 * @target MZ
 * @plugindesc MZ 1.0.0 Restores missing global save info
 * @author McKathlin
 * 
 * @help Save Sync for RPG Maker MZ
 * 
 * Sometimes when Steam Cloud updates people's save files, or when a
 * player pastes in a savefile from a backup, the save files actually present
 * in their game may fall out of sync with the list in global.rpgsave that
 * RPG Maker MZ's runtime uses to populate the Load Menu. This can leave the
 * player unable to access their existing saves. This plugin fixes that issue.
 * 
 * When this Save Sync plugin is active, it resolves any inconsistencies
 * between which savefiles are actually present and which saves are recorded
 * in global.rpgsave.
 * 
 * ============================================================================
 * Compatibility Note
 * 
 * This plugin does not have any known conflicts with existing plugins.
 * If another plugin were to modify DataManager.loadGlobalInfo, this would
 * cause a conflict. Barring that, you may place McKathlin_SaveSync anywhere
 * on your game's plugin list.
 * 
 * ============================================================================
 * MIT License
 *
 * Copyright (c) 2023 Kathy Bunn and Scott Tyrus Washburn
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the “Software”), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 * ============================================================================
 * Happy storytelling!
 * -McKathlin
 */

(() => {

    // Replacement method
    DataManager.loadGlobalInfo = function() {
        let pendingGlobalInfo = null;
        StorageManager.loadObject("global")
            .then(globalInfo => {
                pendingGlobalInfo = globalInfo;
                console.log("Global info loaded.");
            })
            .catch(() => {
                console.warn("Could not load global info. Using empty list");
                pendingGlobalInfo = [];
            })
            .finally(() => {
                this.updateGlobalInfo(pendingGlobalInfo)
                    .then((infoUpdated) => {
                        this._globalInfo = pendingGlobalInfo;
                        if (infoUpdated) {
                            this.saveGlobalInfo();
                        }
                    })
                    .catch((err) => {
                        this._globalInfo = pendingGlobalInfo;
                        console.error("Failed to update global info", err);
                    });
            });
    };

    // New method
    // Supersedes removeInvalidGlobalInfo.
    // Implements global info restoration as well as removal.
    DataManager.updateGlobalInfo = async function(globalInfo) {
        let infoUpdated = false;
        for (let i = 0; i <= this.maxSavefiles(); i++) {
            if (this.savefileExists(i)) {
                // There *should* be a globalInfo entry here.
                if (!globalInfo[i]) {
                    globalInfo[i] = await McKathlin.SaveSync.makeMissingSaveInfo(i);
                    infoUpdated = true;
                }
            } else {
                // There should *not* be a globalInfo entry here.
                if (globalInfo[i]) {
                    delete globalInfo[i];
                    infoUpdated = true;
                }
            }
        }
        return infoUpdated;
    };

    // Static helper methods

    McKathlin.SaveSync.makeMissingSaveInfo = async function(savefileId) {
        console.warn(`Restoring global save info for File ${savefileId}...`);

        // Start with a dummy info object.
        let info = {
            title: $dataSystem.gameTitle,
            characters: [],
            faces: [],
            playtime: "??:??:??",
            timestamp: Date.now(),
        };

        const saveName = DataManager.makeSavename(savefileId);
        const saveContents = await StorageManager.loadObject(saveName);

        try {
            // Extract save-specific data
            info.characters = McKathlin.SaveSync.extractCharacters(saveContents);
            info.faces = McKathlin.SaveSync.extractFaces(saveContents);
            info.playtime = McKathlin.SaveSync.extractPlaytime(saveContents);

            console.log(`File ${savefileId}'s info has been restored successfully.`);
            return info;
        } catch (err) {
            console.error(`Failed to restore some of File ${savefileId}'s save info:`, err);
            console.warn(`You can still try loading File ${savefileId}.`);
        }
        return info;
    };

    McKathlin.SaveSync.extractCharacters = function(saveContents) {
        const members = this.extractPartyMembers(saveContents);
        return members.map((actor) =>
            [actor.characterName(), actor.characterIndex()]);
    };

    McKathlin.SaveSync.extractFaces = function(saveContents) {
        const members = this.extractPartyMembers(saveContents);
        return members.map((actor) => [actor.faceName(), actor.faceIndex()]);
    };

    McKathlin.SaveSync.extractPlaytime = function(saveContents) {
        const frames = saveContents.system._framesOnSave;
        const totalSeconds = Math.floor(frames / 60);

        const hour = Math.floor(totalSeconds / 60 / 60);
        const min = Math.floor(totalSeconds / 60) % 60;
        const sec = totalSeconds % 60;

        return `${hour.padZero(2)}:${min.padZero(2)}:${sec.padZero(2)}`;
    };

    McKathlin.SaveSync.extractPartyMembers = function(saveContents) {
        // Get the IDs of the active party members.
        const maxActive = saveContents.party.maxBattleMembers();
        const memberIds = saveContents.party._actors.slice(0, maxActive);
        
        // Return the actors with those IDs.
        const gameActors = saveContents.actors;
        const members = memberIds.map((id) => gameActors.actor(id));
        return members;
    };

})();
