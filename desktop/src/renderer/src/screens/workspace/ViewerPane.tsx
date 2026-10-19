import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DropzoneStage } from './DropzoneStage'

const VIEWS = [
  { value: '3d', label: '3D' },
  { value: 'schematic', label: 'Schematic' },
  { value: 'dp', label: 'ΔP plot' }
] as const

function EmptyView({ text }: { text: string }): React.JSX.Element {
  return <p className="bg-bg px-3 py-1 text-body text-text-muted">{text}</p>
}

export function ViewerPane(): React.JSX.Element {
  return (
    <Tabs defaultValue="3d" className="flex h-full flex-col bg-bg">
      <TabsList aria-label="Viewer">
        {VIEWS.map((v) => (
          <TabsTrigger key={v.value} value={v.value}>
            {v.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="3d" className="halftone flex items-center justify-center overflow-hidden">
        <DropzoneStage />
      </TabsContent>
      <TabsContent
        value="schematic"
        className="halftone flex items-center justify-center overflow-hidden"
      >
        <EmptyView text="The schematic appears once a model is loaded." />
      </TabsContent>
      <TabsContent value="dp" className="halftone flex items-center justify-center overflow-hidden">
        <EmptyView text="Run a solve to plot pressure drop along a path." />
      </TabsContent>
    </Tabs>
  )
}
