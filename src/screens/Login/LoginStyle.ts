import { StyleSheet } from 'react-native';
import Colors from '../../constants/colors';
import Spacing from '../../constants/spacing';
import Typography from '../../constants/typography';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.lg,
    backgroundColor: Colors.background,
  },

  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: Spacing.lg,
    elevation: 5,
  },

  logo: {
    fontSize: 50,
    textAlign: 'center',
  },

  title: {
    fontSize: Typography.title,
    fontWeight: 'bold',
    textAlign: 'center',
    color: Colors.primary,
    marginTop: Spacing.md,
  },

  subtitle: {
    textAlign: 'center',
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xl,
  },

  button: {
    marginTop: Spacing.md,
  },
});

export default styles;