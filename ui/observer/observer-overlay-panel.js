/*
 * Zatygold's Spectator - a playable Spectator for Civilization VII.
 * Copyright (C) 2026  Zatygold
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Zatygold's Spectator - Observer overlay panel (in-game scope).
 *
 * Base class of the Observer's own overlay panels (observer-overview.js,
 * observer-settlement.js): focus on open, and the frame's close button,
 * cancel or the system menu closing the panel.
 */
import { InputEngineEventName } from 'fs://game/core/ui/input/input-support.js';
import Panel from 'fs://game/core/ui/panel-support.js';
import { FocusManager } from 'fs://game/core/ui-next/services/focus-manager.js';

class ObserverOverlayPanel extends Panel {
  engineInputListener = this.onEngineInput.bind(this);
  closeListener = () => this.close();

  onAttach() {
    super.onAttach();
    this.frame = this.Root.querySelector('fxs-subsystem-frame');
    this.Root.addEventListener(InputEngineEventName, this.engineInputListener);
    this.frame?.addEventListener('subsystem-frame-close', this.closeListener);
  }

  onDetach() {
    this.Root.removeEventListener(InputEngineEventName, this.engineInputListener);
    this.frame?.removeEventListener('subsystem-frame-close', this.closeListener);
    super.onDetach();
  }

  onReceiveFocus() {
    super.onReceiveFocus();
    FocusManager.get().setFocus(this.Root);
  }

  onEngineInput(ev) {
    if (ev.detail.status !== InputActionStatuses.FINISH) return;
    if (ev.isCancelInput() || ev.detail.name === 'sys-menu') {
      this.close();
      ev.stopPropagation();
      ev.preventDefault();
    }
  }
}

export { ObserverOverlayPanel };
