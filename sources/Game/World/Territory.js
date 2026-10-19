import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'

/**
 * 「划地盘」领地围栏（数据驱动、纯视觉、可多块）
 * 读取 static/territory/territory.json 的 territories[]，把 static/territory/fence.glb
 * （竖立的木板栏杆件，宽沿局部 X、底面在 y=0）沿每块矩形四周首尾相接摆成一圈。
 *
 * 须翊恒的右下角矩形保持原样。Peter 只追加一块矩形，用同一套原木栏杆。
 *
 * - 每件用 physics 射线贴地（复用 Floor.js 的 heightfield 碰撞体），落不到地面时兜底到水面高度
 * - 纯视觉：模型名不含 physical，addFromModel 不创建碰撞体，玩家可穿过
 * - 改围栏范围/密度：只改 territory.json，无需动代码
 */
export class Territory
{
    constructor()
    {
        this.game = Game.getInstance()
        this.items = []
        this.territories = []
        this.visible = true

        this.setFromDescription()
    }

    async setFromDescription()
    {
        const cb = '?cb=1'

        let description = null
        try
        {
            const response = await fetch(`territory/territory.json${cb}`)
            if(response.ok)
                description = await response.json()
        }
        catch(error)
        {
            // 尚未配置领地，静默跳过
        }

        const territories = this.getTerritories(description)
        if(!territories.length)
            return

        // 懒加载栏杆件
        let resource
        try
        {
            const resources = await this.game.resourcesLoader.load([
                [ 'territoryFence', `territory/fence.glb${cb}`, 'gltf' ],
            ])
            resource = resources.territoryFence
        }
        catch(error)
        {
            console.log(`Territory > Couldn't load fence: ${error}`)
            return
        }

        if(!resource)
            return

        const bounds = new THREE.Box3().setFromObject(resource.scene)
        const pieceLength = bounds.max.x - bounds.min.x

        for(const territory of territories)
            this.buildTerritory(resource.scene, territory, pieceLength)

        this.setDebug()
    }

    getTerritories(_description)
    {
        if(!_description)
            return []

        if(Array.isArray(_description.territories) && _description.territories.length)
            return _description.territories.filter((territory) => territory && territory.rect)

        if(_description.rect)
            return [ _description ]

        return []
    }

    buildTerritory(_source, _territory, _pieceLength)
    {
        const scale = _territory.scale ?? 1
        const step = _pieceLength * scale * (_territory.overlap ?? 1)
        const points = this.getPerimeterPoints(_territory.rect, step)
        const record = {
            id: _territory.id ?? 'territory',
            owner: _territory.owner ?? '',
            rect: _territory.rect,
            count: points.length,
        }

        for(const point of points)
            this.addSegment(_source, point, scale, _territory)

        this.territories.push(record)
    }

    getPerimeterPoints(_rect, _step)
    {
        const { minX, maxX, minZ, maxZ } = _rect
        const points = []

        // 上/下两条边：沿世界 X 排布，件宽轴(X)对齐 X → rotationY = 0
        for(let x = minX; x <= maxX + 1e-6; x += _step)
        {
            points.push({ x: x, z: minZ, rotationY: 0 })
            points.push({ x: x, z: maxZ, rotationY: 0 })
        }

        // 左/右两条边：沿世界 Z 排布，件宽轴需转到 Z → rotationY = 90°
        for(let z = minZ; z <= maxZ + 1e-6; z += _step)
        {
            points.push({ x: minX, z: z, rotationY: Math.PI / 2 })
            points.push({ x: maxX, z: z, rotationY: Math.PI / 2 })
        }

        return points
    }

    addSegment(_source, _point, _scale, _description)
    {
        const model = _source.clone(true)
        model.scale.setScalar(_scale)
        model.rotation.y = _point.rotationY

        const groundY = this.getGroundElevation(_point.x, _point.z)
        const minY = this.game.water.surfaceElevation + (_description.minAboveWater ?? 0)
        const y = Math.max(groundY, minY) + (_description.yOffset ?? 0)
        model.position.set(_point.x, y, _point.z)

        const object = this.game.objects.addFromModel(model, {}, {})
        this.items.push({ model: model, object: object })
    }

    getGroundElevation(_x, _z)
    {
        const startY = 50
        const ray = new this.game.RAPIER.Ray({ x: _x, y: startY, z: _z }, { x: 0, y: - 1, z: 0 })
        const hit = this.game.physics.world.castRay(ray, 100, true)

        return hit ? startY - hit.timeOfImpact : 0
    }

    setVisible(_visible)
    {
        this.visible = _visible
        for(const item of this.items)
            item.model.visible = _visible
    }

    setDebug()
    {
        if(!this.game.debug.active)
            return

        const debugPanel = this.game.debug.panel.addFolder({
            title: '🚧 Territory',
            expanded: false
        })

        debugPanel.addBinding(this, 'visible', { label: 'visible' }).on('change', () =>
        {
            this.setVisible(this.visible)
        })
    }
}
