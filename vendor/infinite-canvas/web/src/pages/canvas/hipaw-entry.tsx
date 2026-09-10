import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import CanvasProjectPage from './project';
import { useCanvasStore } from '@/stores/canvas/use-canvas-store';
import { defaultConfig, useConfigStore } from '@/stores/use-config-store';
import { useThemeStore } from '@/stores/use-theme-store';
import { useCanvasSidePanelStore } from '@/stores/use-canvas-side-panel-store';
import { CanvasNodeType } from '@/types/canvas';
import { canvasThemes } from '@/lib/canvas-theme';
import './hipaw-entry.css';

export default function HiPawEntry() {
    const { id = 'hipaw' } = useParams();
    const [query] = useSearchParams();
    const hydrated = useCanvasStore(state => state.hydrated);
    const [readyId, setReadyId] = useState('');
    useEffect(() => {
        if (!hydrated) return;
        const store = useCanvasStore.getState();
        if (!store.openProject(id)) {
            const now = new Date().toISOString();
            useCanvasStore.setState({ projects: [...store.projects, {
                id, title: query.get('title') || 'HiPaw 创作', createdAt: now, updatedAt: now,
                nodes: [{ id: id+'-brief', type: CanvasNodeType.Text, title: '创作需求', position: { x: 70, y: 100 }, width: 300, height: 200,
                    metadata: { content: query.get('title') || '在这里写下本次创作需求。', status: 'success', fontSize: 20 } }],
                connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'dots', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 }
            }] });
        }
        useConfigStore.setState({ config: {
            ...defaultConfig, channelMode: 'local', baseUrl: window.location.origin, apiKey: 'managed-by-hipaw',
            channels: [{ id:'hipaw', name:'HiPaw 生图服务', baseUrl:window.location.origin, apiKey:'managed-by-hipaw', apiFormat:'openai', models:[{name:'FLUX.2 [dev]',capability:'image'}] }],
            model:'hipaw::FLUX.2 [dev]', imageModel:'hipaw::FLUX.2 [dev]', models:['hipaw::FLUX.2 [dev]'],
            videoModel:'',textModel:'',audioModel:'',count:'1',canvasImageCount:'1',size:'3:4'
        } });
        useThemeStore.getState().setTheme('light');
        useCanvasSidePanelStore.getState().closePanel();
        setReadyId(id);
    }, [hydrated, id, query]);
    if (readyId !== id) return <div className="hipaw-canvas-loading" style={{ background: canvasThemes.light.canvas.background, color: canvasThemes.light.node.muted }} role="status">正在打开创作画布…</div>;
    return <div className="hipaw-canvas-app"><CanvasProjectPage /></div>;
}
