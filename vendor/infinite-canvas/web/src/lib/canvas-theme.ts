export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#f7f8fa",
            dot: "rgba(50,65,90,.16)",
            line: "rgba(50,65,90,.08)",
            selectionStroke: "#2563eb",
            selectionFill: "rgba(37,99,235,.07)",
        },
        node: {
            label: "#556070",
            fill: "#edf1f6",
            panel: "#ffffff",
            stroke: "#dce2eb",
            activeStroke: "#2563eb",
            placeholder: "#737e8e",
            text: "#242a35",
            muted: "#687485",
            faint: "#8792a2",
        },
        toolbar: {
            panel: "rgba(255,255,255,.97)",
            border: "#dce2eb",
            item: "#556070",
            itemHover: "#edf1f6",
            activeBg: "#eaf2ff",
            activeText: "#245bba",
        },
    },
    dark: {
        canvas: {
            background: "#0d0d0d",
            dot: "rgba(255,255,255,.12)",
            line: "rgba(255,255,255,.07)",
            selectionStroke: "#65bdff",
            selectionFill: "rgba(101,189,255,.08)",
        },
        node: {
            label: "#b8b8bf",
            fill: "#242424",
            panel: "#1a1a1a",
            stroke: "#36363a",
            activeStroke: "#65bdff",
            placeholder: "#99999f",
            text: "#f4f4f5",
            muted: "#a4a4ab",
            faint: "#828289",
        },
        toolbar: {
            panel: "rgba(30,30,30,.96)",
            border: "#ffffff14",
            item: "#b8b8bf",
            itemHover: "#2b2b2e",
            activeBg: "#193347",
            activeText: "#d9efff",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
