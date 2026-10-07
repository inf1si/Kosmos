'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { customPropertiesSchema, customPropertySchema, propertyText, propertyTypes, type CustomProperty } from '@/lib/custom-properties';
import { uid } from '@/lib/model';
import { IconButton, Popover } from './primitives';

export function CustomPropertyChips({properties=[],onOpen}:{properties?:CustomProperty[];onOpen:()=>void}){
  const filled=properties.filter(p=>p.type==='checkbox'||p.value!==''&&p.value!==null);

  return <>{filled.slice(0,3).map(p=><button type="button" className="chip" key={p.id} title={`${p.name} · ${propertyText(p)}`} onClick={onOpen}><span className="notes-tag-summary">{p.name} · {propertyText(p)}</span></button>)}{filled.length>3&&<button type="button" className="chip" onClick={onOpen}>속성 +{filled.length-3}</button>}</>;
}

export function CustomPropertiesForm({properties=[],disabled,onChange}:{properties?:CustomProperty[];disabled:boolean;onChange:(properties:CustomProperty[])=>void}){
  const [open,setOpen]=useState(false),[name,setName]=useState(''),[type,setType]=useState<CustomProperty['type']>('text'),[error,setError]=useState('');

  function add(){
    const property={id:uid(),name:name.trim(),type,value:type==='checkbox'?false:type==='number'?null:''};
    const next=customPropertiesSchema.safeParse([...properties,property]);

    if(!next.success){setError(!name.trim()?'속성 이름을 입력하세요.':'속성 이름의 중복과 길이를 확인하세요.');

return;}

    onChange(next.data);setOpen(false);setName('');setError('');
  }

  function value(id:string,value:string|number|boolean|null){
    onChange(properties.map(p=>p.id===id?customPropertySchema.parse({...p,value}):p));
  }

  return <div className="wide custom-properties">
    <div className="custom-property-fields">{properties.map(p=><div key={p.id} className="custom-property-field">
      {p.type==='checkbox'?<label className="check-label"><input type="checkbox" aria-label={p.name} checked={p.value} disabled={disabled} onChange={e=>value(p.id,e.target.checked)}/>{p.name}</label>:<label>{p.name}<input aria-label={p.name} type={p.type==='number'?'number':p.type==='date'?'date':'text'} step={p.type==='number'?'any':undefined} maxLength={p.type==='text'?2000:undefined} value={p.value??''} disabled={disabled} onChange={e=>value(p.id,p.type==='number'?(e.target.value===''?null:e.target.valueAsNumber):e.target.value)}/></label>}
      <IconButton label={`${p.name} 속성 삭제`} disabled={disabled} onClick={()=>onChange(properties.filter(item=>item.id!==p.id))}><X size={14}/></IconButton>
    </div>)}</div>
    <Popover open={open} onOpenChange={value=>{setOpen(value);setError('');}} width={300} title="속성 추가" trigger={<button type="button" className="button" disabled={disabled||properties.length>=40}><Plus size={14}/>속성 추가</button>}>
      <form className="form-grid" onSubmit={e=>{e.preventDefault();add();}}><label>속성 이름<input autoFocus aria-label="새 속성 이름" maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label><label>형식<select aria-label="새 속성 형식" value={type} onChange={e=>setType(customPropertySchema.options.find(o=>o.shape.type.value===e.target.value)!.shape.type.value)}>{Object.entries(propertyTypes).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>{error&&<p className="error-message" role="alert">{error}</p>}<div className="popover-actions"><button type="submit" className="button" disabled={disabled}>추가</button></div></form>
    </Popover>
  </div>;
}
