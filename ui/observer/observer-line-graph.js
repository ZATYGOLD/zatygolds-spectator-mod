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
 * Zatygold's Spectator - turn line graph (in-game scope).
 *
 * The game's LineGraph (core/ui-next/components/line-graph.js) rebuilt on its
 * Chart.js with the same look, plus what the graphs need: chosen x ticks
 * with their own labels (each Age's turns counted from 1), Age dividers (a
 * faint line with the Age's name) and crisis stage flags (a faint dashed
 * coloured line between two small markers, at the top and on the turn axis).
 *
 * Props: lines ([{ color, points: [{ x, y }] }]), maxX, maxY, width, ticks
 * (x values), tickLabel (x => text), dividers ([{ x, label }]), flags ([{ x,
 * color }]), minY, axisLabelX, axisLabelY, gridColor, axisNumberColor,
 * axisLabelColor, class.
 */
import { createEffect, onCleanup, onMount } from 'fs://game/core/vendor/solid-js/dist/solid.js';
import { Layout } from 'fs://game/core/ui/utilities/utilities-layout.js';

/** The body font LineGraph uses for the current language. */
const LOCALE_FONTS = { ko_KR: 'BodyFont-KR', ja_JP: 'BodyFont-JP', zh_Hans_CN: 'BodyFont-SC', zh_Hant_HK: 'BodyFont-TC' };
const bodyFont = () => LOCALE_FONTS[Locale.getCurrentDisplayLocale()] ?? 'BodyFont';
const DIVIDER = { color: 'rgba(225, 214, 180, 0.45)', label: 'rgba(225, 214, 180, 0.8)', gap: 6 };
const FLAG = { size: 7, lineAlpha: 0.35, dash: [6, 5] };   // marker half-width and dash in pixels, line opacity

/** Age dividers over the plot, crisis flags standing on the turn axis. */
const marksPlugin = (marks) => ({
  id: 'zomMarks',
  afterDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    const { dividers, flags } = marks();
    const size = Chart.defaults.font.size;
    const inside = (x) => x >= chartArea.left - 1 && x <= chartArea.right + 1;
    ctx.save();
    ctx.font = `${size}px ${bodyFont()}`;
    for (const divider of dividers) {
      const x = scales.x.getPixelForValue(divider.x);
      if (!inside(x)) continue;
      ctx.fillStyle = DIVIDER.color;
      ctx.fillRect(Math.round(x), chartArea.top, 1, chartArea.bottom - chartArea.top);
      ctx.fillStyle = DIVIDER.label;
      ctx.textBaseline = 'top';
      ctx.fillText(divider.label, x + DIVIDER.gap, chartArea.top + DIVIDER.gap);
    }
    for (const flag of flags) {
      const x = scales.x.getPixelForValue(flag.x);
      if (!inside(x)) continue;
      const { top, bottom } = chartArea;
      const tip = FLAG.size * 1.6;
      ctx.strokeStyle = flag.color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = FLAG.lineAlpha;
      ctx.setLineDash(FLAG.dash);
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, top + tip);
      ctx.lineTo(Math.round(x) + 0.5, bottom - tip);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.fillStyle = flag.color;
      for (const [base, direction] of [[bottom, -1], [top, 1]]) {
        ctx.beginPath();
        ctx.moveTo(x - FLAG.size, base);
        ctx.lineTo(x + FLAG.size, base);
        ctx.lineTo(x, base + direction * tip);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }
});

function chartConfig(props) {
  const ticks = [...(props.ticks ?? [])];
  return {
    type: 'line',
    data: {
      datasets: props.lines.map((line) => ({
        data: line.points.map((p) => ({ x: p.x, y: p.y })),
        fill: false,
        borderColor: line.color,
        borderWidth: props.width,
        tension: 0,
        spanGaps: true
      }))
    },
    options: {
      animation: false,
      normalized: true,
      maintainAspectRatio: false,
      elements: { point: { radius: 0 } },
      scales: {
        x: {
          type: 'linear',
          min: 1,
          max: props.maxX,
          grid: { color: 'transparent' },
          afterBuildTicks: (scale) => { if (ticks.length) scale.ticks = ticks.map((value) => ({ value })); },
          ticks: { color: props.axisNumberColor, autoSkip: false, maxRotation: 0, callback: (value) => props.tickLabel?.(value) ?? value },
          title: { display: props.axisLabelX != null, text: props.axisLabelX ?? '', color: props.axisLabelColor, padding: { top: 0, bottom: 16 } }
        },
        y: {
          type: 'linear',
          min: props.minY ?? 0,
          max: props.maxY,
          grid: { color: props.gridColor ?? 'transparent' },
          ticks: { color: props.axisNumberColor },
          title: { display: props.axisLabelY != null, text: props.axisLabelY ?? '', color: props.axisLabelColor, padding: 0 }
        }
      },
      plugins: { legend: { display: false }, title: { display: false }, tooltip: { enabled: false } }
    }
  };
}

const TurnLineGraph = (props) => {
  const canvas = document.createElement('canvas');
  let chart;
  let marks = { dividers: [], flags: [] };
  onMount(() => {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.font.size = Layout.textSizeToScreenPixels('base');
    Chart.defaults.font.family = bodyFont();
    chart = new Chart(canvas.getContext('2d'), { ...chartConfig(props), plugins: [marksPlugin(() => marks)] });
  });
  createEffect(() => {
    const config = chartConfig(props);   // tracks every prop the chart reads
    marks = { dividers: [...(props.dividers ?? [])], flags: [...(props.flags ?? [])] };
    if (!chart) return;
    chart.data = config.data;
    chart.options = config.options;
    chart.update();
  });
  onCleanup(() => { chart?.destroy(); chart = undefined; });
  createEffect(() => { canvas.className = props.class ?? ''; });
  return canvas;
};

export { TurnLineGraph };
