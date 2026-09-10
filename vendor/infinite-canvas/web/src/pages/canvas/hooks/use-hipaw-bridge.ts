import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from '@/types/canvas';
import { imageToDataUrl, uploadImage } from '@/services/image-storage';
import { imageMetadata } from '@/lib/canvas/canvas-node-factory';
import { fitNodeSize } from '@/lib/canvas/canvas-node-size';
import { setHiPawOptions } from '@/services/api/hipaw';

export function useHiPawBridge(ready: boolean, nodes: CanvasNodeData[], selected: Set<string>, setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>, setSelected: Dispatch<SetStateAction<Set<string>>>, setViewport: Dispatch<SetStateAction<ViewportTransform>>) {
    const current = useRef({ nodes, selected });
    current.current = { nodes, selected };
    useEffect(() => {
        if (!ready || !location.pathname.includes('/embed/')) return;
        const send = (payload: object) => window.parent.postMessage(payload, location.origin);
        const receive = async (event: MessageEvent) => {
            if (event.origin !== location.origin || event.source !== window.parent) return;
            const data = event.data;
            try {
                if (data.type === 'hipaw:ping') send({ type:'hipaw:ready' });
                if (data.type === 'hipaw:options') setHiPawOptions({useBrand:data.useBrand!==false,useMascot:data.useMascot===true,taskId:data.taskId});
                if (data.type === 'hipaw:images' && Array.isArray(data.images)) {
                    const additions: CanvasNodeData[] = [];
                    const existing = current.current.nodes;
                    const startX = existing.length ? Math.max(...existing.map(n=>n.position.x+n.width))+60 : 70;
                    for (const [index, source] of data.images.entries()) {
                        const url = new URL(source.url, location.origin);
                        if (url.origin !== location.origin || !url.pathname.startsWith('/media/')) throw new Error('图片需要先保存在工作台');
                        const uploaded = await uploadImage(url.href);
                        additions.push({id:crypto.randomUUID(),type:CanvasNodeType.Image,title:String(source.title || '图片'),position:{x:startX+index*340,y:100},...fitNodeSize(uploaded.width,uploaded.height),metadata:imageMetadata(uploaded)});
                    }
                    setNodes(prev=>[...prev,...additions]); setSelected(new Set(additions.map(n=>n.id)));
                    setViewport({x:50-startX,y:0,k:1});
                }
                if (data.type === 'hipaw:selection') {
                    const images = await Promise.all(current.current.nodes.filter(n=>current.current.selected.has(n.id)&&n.type===CanvasNodeType.Image&&n.metadata?.content).map(async n=>({title:n.title,dataUrl:await imageToDataUrl({dataUrl:n.metadata!.content!,storageKey:n.metadata?.storageKey})})));
                    send({type:'hipaw:selection',purpose:data.purpose,images});
                }
            } catch (error) { send({type:'hipaw:error',message:error instanceof Error?error.message:'图片没有导入成功'}); }
        };
        window.addEventListener('message',receive);
        send({type:'hipaw:ready'});
        return ()=>window.removeEventListener('message',receive);
    }, [ready,setNodes,setSelected,setViewport]);
}
