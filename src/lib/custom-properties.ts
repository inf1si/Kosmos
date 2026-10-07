import { z } from 'zod';

const field={id:z.uuid(),name:z.string().trim().min(1).max(80)};

export const customPropertySchema=z.discriminatedUnion('type',[
  z.object({...field,type:z.literal('text'),value:z.string().max(2000)}),
  z.object({...field,type:z.literal('number'),value:z.number().finite().nullable()}),
  z.object({...field,type:z.literal('date'),value:z.union([z.literal(''),z.iso.date()])}),
  z.object({...field,type:z.literal('checkbox'),value:z.boolean()}),
]);

export const customPropertiesSchema=z.array(customPropertySchema).max(40).superRefine((items,ctx)=>{
  if(new Set(items.map(p=>p.id)).size!==items.length||new Set(items.map(p=>p.name.toLocaleLowerCase())).size!==items.length)ctx.addIssue({code:'custom',message:'속성 이름이 중복됩니다.'});
});

export type CustomProperty=z.infer<typeof customPropertySchema>;

export const propertyTypes={text:'텍스트',number:'숫자',date:'날짜',checkbox:'체크박스'} as const;

export function propertyText(property:CustomProperty):string{
  return property.type==='checkbox'?(property.value?'체크됨':'체크 안 됨'):property.value===null?'':String(property.value);
}
