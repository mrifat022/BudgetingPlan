import React, {useEffect, useState} from 'react';
import {KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Picker} from '@react-native-picker/picker';
import DateTimePicker, {type DateTimePickerEvent} from '@react-native-community/datetimepicker';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import Colors from '../constants/colors';
import PrimaryCurrencyInput from './CurrencyInput/PrimaryCurrencyInput';
import PrimaryButton from './Button/PrimaryButton';

export function FormModal({visible, title, onClose, children}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.safe}>
          <View style={styles.handle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <Pressable accessibilityLabel="Tutup" style={styles.close} onPress={onClose}><MaterialCommunityIcons name="close" size={22} color={Colors.textSecondary} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Label({children}: {children: React.ReactNode}) {
  return <Text style={styles.label}>{children}</Text>;
}

export function TextField(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor="#99A39F" {...props} style={[styles.input, props.multiline && styles.multiline, props.style]} />;
}

export function MoneyField({value, onChangeValue}: {value: number | null; onChangeValue: (value: number | null) => void}) {
  return <PrimaryCurrencyInput value={value} onChangeValue={onChangeValue} />;
}

function dateFromISO(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function dateToISO(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export function DateField({value, onChange}: {value: string; onChange: (value: string) => void}) {
  const [open, setOpen] = useState(false);
  const selected = dateFromISO(value);
  const handleChange = (event: DateTimePickerEvent, next?: Date) => {
    if (Platform.OS === 'android') { setOpen(false); }
    if (event.type === 'set' && next) { onChange(dateToISO(next)); }
  };
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel="Pilih tanggal" style={styles.dateField} onPress={() => setOpen(true)}>
        <View style={styles.dateBody}>
          <Text style={styles.dateText}>{selected.toLocaleDateString('id-ID', {day: '2-digit', month: 'long', year: 'numeric'})}</Text>
          <Text style={styles.dateISO}>{value}</Text>
        </View>
        <MaterialCommunityIcons name="calendar-blank-outline" size={20} color={Colors.textPrimary} />
      </Pressable>
      {open ? <DateTimePicker value={selected} mode="date" display="default" onChange={handleChange} /> : null}
    </>
  );
}

export function SelectField({value, onChange, options}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{label: string; value: string}>;
}) {
  const hasSelectedValue = options.some(option => option.value === value);
  const selectedValue = hasSelectedValue ? value : options[0]?.value ?? '';

  // Android dapat menyorot opsi pertama tanpa menyimpan nilainya ke state JS.
  // Sinkronkan nilai fallback supaya tampilan dan validasi selalu konsisten.
  useEffect(() => {
    if (!hasSelectedValue && selectedValue) {
      onChange(selectedValue);
    }
  }, [hasSelectedValue, onChange, selectedValue]);

  return (
    <View style={styles.pickerWrap}>
      <Picker
        selectedValue={selectedValue}
        onValueChange={itemValue => onChange(String(itemValue))}
        style={styles.picker}
        dropdownIconColor={Colors.textSecondary}>
        {options.map(option => (
          <Picker.Item
            key={option.value}
            label={option.label}
            value={option.value}
            color={Colors.textPrimary}
          />
        ))}
      </Picker>
    </View>
  );
}

export function SegmentedField({value, onChange, options}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{label: string; value: string}>;
}) {
  return <View style={styles.segmented}>{options.map(option => {
    const active = value === option.value;
    return <Pressable key={option.value} style={[styles.segment, active && styles.segmentActive]} onPress={() => onChange(option.value)}><Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1}>{option.label}</Text></Pressable>;
  })}</View>;
}

export function FormActions({saveLabel = 'Simpan', onSave, onCancel, disabled}: {
  saveLabel?: string;
  onSave: () => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.actions}>
      <PrimaryButton title={saveLabel} disabled={disabled} onPress={onSave} />
      <Pressable style={styles.cancelAction} onPress={onCancel}><Text style={styles.cancelText}>Batal</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(13,27,21,0.48)'},
  safe: {maxHeight: '90%', backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden'},
  handle: {width: 44, height: 5, borderRadius: 3, backgroundColor: Colors.border, alignSelf: 'center', marginTop: 11},
  modalHeader: {height: 67, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.surface},
  modalTitle: {fontSize: 20, fontWeight: '900', color: Colors.textPrimary},
  close: {width: 40, height: 40, alignItems: 'center', justifyContent: 'center'},
  content: {paddingHorizontal: 22, paddingTop: 10, paddingBottom: 18},
  label: {fontSize: 13, fontWeight: '700', color: Colors.textSecondary, marginTop: 14, marginBottom: 7},
  input: {height: 58, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, paddingHorizontal: 16, fontSize: 16, backgroundColor: Colors.surface, color: Colors.textPrimary},
  multiline: {height: 82, paddingTop: 13, textAlignVertical: 'top'},
  pickerWrap: {height: 58, justifyContent: 'center', borderWidth: 1, borderColor: Colors.border, borderRadius: 14, overflow: 'hidden', backgroundColor: Colors.surface},
  picker: {color: Colors.textPrimary, backgroundColor: Colors.surface},
  dateField: {height: 58, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface},
  dateBody: {flex: 1},
  dateText: {fontSize: 15, color: Colors.textPrimary},
  dateISO: {display: 'none'},
  segmented: {flexDirection: 'row', gap: 8},
  segment: {flex: 1, minHeight: 48, paddingHorizontal: 8, borderRadius: 13, borderWidth: 1, borderColor: Colors.border, backgroundColor: '#FAFBFA', alignItems: 'center', justifyContent: 'center'},
  segmentActive: {backgroundColor: Colors.primary, borderColor: Colors.primary},
  segmentText: {fontSize: 12, color: Colors.textSecondary, fontWeight: '700'},
  segmentTextActive: {color: Colors.white},
  actions: {marginTop: 28},
  cancelAction: {height: 42, alignItems: 'center', justifyContent: 'center'},
  cancelText: {fontSize: 13, color: Colors.textSecondary, fontWeight: '700'},
});
